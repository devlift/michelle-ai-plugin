/**
 * Michelle AI — Public Chat Widget
 * Vanilla JS, no dependencies.
 */
(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Config injected by wp_localize_script (michelleAICfg)
    // -------------------------------------------------------------------------
    const cfg = window.michelleAICfg || {};
    const API = cfg.restUrl || '';   // e.g. https://site.com/wp-json/michelle-ai/v1
    const chatEnabled = cfg.chatEnabled !== false;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    let state = {
        open:           false,
        conversationId: null,
        token:          null,
        lastPollTime:   null,
        pollTimer:      null,
        streaming:      false,
        notifGranted:   false,
    };

    // Persist session across page loads
    function loadSession() {
        try {
            state.conversationId = parseInt( localStorage.getItem('mai_conv_id'), 10 ) || null;
            state.token          = localStorage.getItem('mai_token') || null;
        } catch (e) {}
    }
    function saveSession() {
        try {
            localStorage.setItem('mai_conv_id', state.conversationId);
            localStorage.setItem('mai_token',   state.token);
        } catch (e) {}
    }

    // -------------------------------------------------------------------------
    // DOM refs (populated after DOMContentLoaded)
    // -------------------------------------------------------------------------
    let fab, chatWindow, messagesEl, typingEl, inputEl, sendBtn, unreadDot;

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------
    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function formatTime(isoStr) {
        const d = isoStr ? new Date(isoStr) : new Date();
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // -------------------------------------------------------------------------
    // Notification permission
    // -------------------------------------------------------------------------
    function requestNotifPermission() {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            state.notifGranted = true;
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(p => {
                state.notifGranted = p === 'granted';
            });
        }
    }

    function fireNotification(text) {
        if (!state.notifGranted || document.hasFocus()) return;
        const n = new Notification(cfg.widgetTitle || 'New message', {
            body: text,
            icon: cfg.logoUrl || '',
        });
        n.onclick = () => { window.focus(); openWidget(); n.close(); };
        setTimeout(() => n.close(), 6000);
    }

    // -------------------------------------------------------------------------
    // Widget open / close
    // -------------------------------------------------------------------------
    function openWidget() {
        if (state.open) return;
        state.open = true;
        chatWindow.hidden = false;
        chatWindow.classList.remove('mai-closing');
        chatWindow.classList.add('mai-opening');
        fab.querySelector('.mai-fab-open').hidden = true;
        fab.querySelector('.mai-fab-close').hidden = false;
        clearUnread();

        if (!state.conversationId) {
            startConversation();
        } else {
            // Resume: load history
            fetchMessages(null, true);
            startPolling();
        }
        requestNotifPermission();
    }

    function closeWidget() {
        if (!state.open) return;
        state.open = false;
        chatWindow.classList.remove('mai-opening');
        chatWindow.classList.add('mai-closing');
        chatWindow.addEventListener('animationend', () => {
            chatWindow.hidden = true;
        }, { once: true });
        fab.querySelector('.mai-fab-open').hidden = false;
        fab.querySelector('.mai-fab-close').hidden = true;
        stopPolling();
    }

    // -------------------------------------------------------------------------
    // Conversation management
    // -------------------------------------------------------------------------
    async function startConversation() {
        try {
            const res = await apiFetch('/conversations', 'POST', {});
            state.conversationId = res.conversation_id;
            state.token          = res.token;
            saveSession();
            // Load welcome message
            fetchMessages(null, true);
            startPolling();
        } catch(e) {
            appendSystemMsg('Could not connect. Please try again.');
        }
    }

    // -------------------------------------------------------------------------
    // Message rendering
    // -------------------------------------------------------------------------
    function appendMessage(msg) {
        const wrap = document.createElement('div');
        wrap.className = `mai-message mai-from-${msg.sender_type}`;
        wrap.dataset.id = msg.id;

        const bubble = document.createElement('div');
        bubble.className = 'mai-bubble';
        bubble.textContent = msg.content;

        const meta = document.createElement('div');
        meta.className = 'mai-msg-meta';
        meta.textContent = (msg.sender_type === 'visitor' ? 'You' : (cfg.agentName || 'Support')) + ' · ' + formatTime(msg.created_at);

        wrap.appendChild(bubble);
        wrap.appendChild(meta);

        // Quick reply chips
        if (msg.quick_replies && msg.quick_replies.length && msg.sender_type !== 'visitor') {
            const qrEl = renderQuickReplies(msg.quick_replies);
            wrap.appendChild(qrEl);
        }

        messagesEl.appendChild(wrap);
        scrollToBottom();
    }

    function appendSystemMsg(text) {
        const el = document.createElement('div');
        el.style.cssText = 'text-align:center;font-size:12px;color:var(--mai-muted);padding:4px 0;';
        el.textContent = text;
        messagesEl.appendChild(el);
        scrollToBottom();
    }

    function renderQuickReplies(options) {
        const row = document.createElement('div');
        row.className = 'mai-quick-replies';
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'mai-qr-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                row.remove();   // dismiss all chips
                sendMessage(opt);
            });
            row.appendChild(btn);
        });
        return row;
    }

    // Create an empty streaming bubble, return its bubble element
    function createStreamingBubble() {
        const wrap = document.createElement('div');
        wrap.className = 'mai-message mai-from-ai';
        wrap.id = 'mai-streaming-bubble';

        const bubble = document.createElement('div');
        bubble.className = 'mai-bubble';
        bubble.textContent = '';

        wrap.appendChild(bubble);
        messagesEl.appendChild(wrap);
        scrollToBottom();
        return bubble;
    }

    // -------------------------------------------------------------------------
    // Send message
    // -------------------------------------------------------------------------
    async function sendMessage(text) {
        if (!text || state.streaming) return;
        if (!state.conversationId) return;

        // Render visitor bubble immediately
        appendMessage({
            id:          Date.now(),
            sender_type: 'visitor',
            content:     text,
            created_at:  new Date().toISOString(),
        });

        inputEl.value = '';
        inputEl.style.height = 'auto';
        sendBtn.disabled = true;

        // POST to REST
        try {
            await apiFetch(`/conversations/${state.conversationId}/messages`, 'POST', { content: text });
        } catch(e) {
            appendSystemMsg('Failed to send message.');
            sendBtn.disabled = false;
            return;
        }

        // Show typing indicator
        typingEl.hidden = false;
        scrollToBottom();

        // Open SSE stream for AI response
        openStream();
    }

    // -------------------------------------------------------------------------
    // SSE stream (AI response)
    // -------------------------------------------------------------------------
    function openStream() {
        state.streaming = true;
        stopPolling();     // pause polling while streaming

        const url = new URL(`${API}/conversations/${state.conversationId}/stream`);
        url.searchParams.set('token', state.token);

        const es = new EventSource(url.toString());
        let bubble = null;
        let fullText = '';

        es.onmessage = (e) => {
            if (e.data === '[DONE]') {
                es.close();
                typingEl.hidden = true;
                state.streaming = false;
                sendBtn.disabled = false;

                // Finalize streaming bubble timestamp
                if (bubble) {
                    const wrap = document.getElementById('mai-streaming-bubble');
                    if (wrap) {
                        wrap.removeAttribute('id');
                        const meta = document.createElement('div');
                        meta.className = 'mai-msg-meta';
                        meta.textContent = (cfg.agentName || 'Support') + ' · ' + formatTime(null);
                        wrap.appendChild(meta);
                    }
                }

                // Update last poll time and resume polling
                state.lastPollTime = new Date().toISOString();
                startPolling();
                return;
            }

            const data = JSON.parse(e.data);

            if (data.token !== undefined) {
                if (!bubble) {
                    typingEl.hidden = true;
                    bubble = createStreamingBubble();
                }
                fullText += data.token;
                bubble.textContent = fullText;
                scrollToBottom();
            }

            if (data.quick_replies && data.quick_replies.length) {
                const wrap = document.getElementById('mai-streaming-bubble') || bubble?.closest('.mai-message');
                if (wrap) {
                    const existing = wrap.querySelector('.mai-quick-replies');
                    if (!existing) wrap.appendChild(renderQuickReplies(data.quick_replies));
                }
            }
        };

        es.onerror = () => {
            es.close();
            typingEl.hidden = true;
            state.streaming = false;
            sendBtn.disabled = false;
            startPolling();
        };
    }

    // -------------------------------------------------------------------------
    // Long-polling for new messages from admin
    // -------------------------------------------------------------------------
    function startPolling() {
        stopPolling();
        if (!state.conversationId) return;
        state.pollTimer = setInterval(fetchMessages, 2000);
    }

    function stopPolling() {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }

    async function fetchMessages(ts, all) {
        if (!state.conversationId) return;
        try {
            const since = (all || !state.lastPollTime) ? '' : state.lastPollTime;
            const url   = `${API}/conversations/${state.conversationId}/messages?token=${encodeURIComponent(state.token)}${since ? '&since=' + encodeURIComponent(since) : ''}`;
            const msgs  = await apiFetch(url, 'GET');
            if (!msgs || !msgs.length) return;

            const existingIds = new Set(
                Array.from(messagesEl.querySelectorAll('.mai-message[data-id]')).map(el => parseInt(el.dataset.id, 10))
            );

            msgs.forEach(msg => {
                if (!existingIds.has(msg.id)) {
                    appendMessage(msg);
                    if (msg.sender_type !== 'visitor') {
                        // Show unread dot if widget is closed
                        if (!state.open) showUnread();
                        fireNotification(msg.content);
                    }
                }
            });

            if (msgs.length) {
                state.lastPollTime = msgs[msgs.length - 1].created_at;
            }
        } catch(e) {
            // silent fail on poll errors
        }
    }

    // -------------------------------------------------------------------------
    // Unread indicator
    // -------------------------------------------------------------------------
    function showUnread() {
        fab.classList.add('mai-has-unread');
        unreadDot.hidden = false;
    }

    function clearUnread() {
        fab.classList.remove('mai-has-unread');
        unreadDot.hidden = true;
    }

    // -------------------------------------------------------------------------
    // Contact form (chat = OFF mode)
    // -------------------------------------------------------------------------
    function initContactForm() {
        const form = document.getElementById('mai-contact-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl     = document.getElementById('mai-cf-error');
            const successEl = document.getElementById('mai-cf-success');
            const successMsg = document.getElementById('mai-cf-success-msg');
            const submitBtn = form.querySelector('.mai-cf-submit');

            errEl.hidden = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';

            const data = {
                name:    form.querySelector('[name=name]').value.trim(),
                address: form.querySelector('[name=address]').value.trim(),
                email:   form.querySelector('[name=email]').value.trim(),
                message: form.querySelector('[name=message]').value.trim(),
            };

            try {
                const res = await apiFetch('/contact', 'POST', data);
                form.hidden = true;
                successMsg.textContent = res.message || 'Thanks! We\'ll be in touch soon.';
                successEl.hidden = false;
            } catch(err) {
                errEl.textContent = err.message || 'Something went wrong. Please try again.';
                errEl.hidden = false;
                submitBtn.disabled = false;
                submitBtn.textContent = form.dataset.submitLabel || 'Send Message';
            }
        });
    }

    // -------------------------------------------------------------------------
    // API helper
    // -------------------------------------------------------------------------
    async function apiFetch(path, method, body) {
        const isFullUrl = path.startsWith('http');
        const url = isFullUrl ? path : (API + path);
        const opts = {
            method:  method || 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        if (state.token) opts.headers['X-Chat-Token'] = state.token;
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        const json = await res.json();

        if (!res.ok) {
            throw new Error(json.message || 'Request failed');
        }
        return json;
    }

    // -------------------------------------------------------------------------
    // Auto-grow textarea
    // -------------------------------------------------------------------------
    function autoGrow(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 100) + 'px';
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    function init() {
        fab        = document.getElementById('mai-fab');
        chatWindow = document.getElementById('mai-chat-window');
        messagesEl = document.getElementById('mai-messages');
        typingEl   = document.getElementById('mai-typing');
        inputEl    = document.getElementById('mai-input');
        sendBtn    = document.getElementById('mai-send-btn');
        unreadDot  = fab ? fab.querySelector('.mai-unread-dot') : null;

        if (!fab) return;  // widget not in DOM

        loadSession();

        fab.addEventListener('click', () => state.open ? closeWidget() : openWidget());
        document.getElementById('mai-close-btn')?.addEventListener('click', closeWidget);

        if (chatEnabled && inputEl && sendBtn) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = inputEl.value.trim();
                    if (text) sendMessage(text);
                }
            });
            inputEl.addEventListener('input', () => autoGrow(inputEl));
            sendBtn.addEventListener('click', () => {
                const text = inputEl.value.trim();
                if (text) sendMessage(text);
            });
        } else {
            initContactForm();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
