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
        hasOlder:       false,
        loadingOlder:   false,
        oldestMsgId:    null,
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

    function getAgentInitial() {
        return (cfg.agentName || 'S').charAt(0).toUpperCase();
    }

    function createAvatarEl(senderType) {
        const avatar = document.createElement('div');
        avatar.className = 'mai-msg-avatar';
        if (senderType === 'visitor') {
            // Person silhouette icon
            avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z" fill="currentColor"/></svg>';
        } else if (cfg.logoUrl) {
            const img = document.createElement('img');
            img.src = cfg.logoUrl;
            img.alt = cfg.agentName || 'Agent';
            avatar.appendChild(img);
        } else {
            avatar.textContent = getAgentInitial();
        }
        return avatar;
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
        fab.classList.add('mai-fab-active');
        clearUnread();

        if (!state.conversationId) {
            startConversation();
        } else {
            // Resume existing session — load full history immediately
            resumeSession();
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
        fab.classList.remove('mai-fab-active');
        stopPolling();
    }

    /**
     * Resume an existing session: validate the token by loading latest messages.
     * If the token is expired (403), start a fresh conversation instead.
     */
    async function resumeSession() {
        try {
            // Load latest 30 messages (paginated)
            const url = `${API}/conversations/${state.conversationId}/messages?token=${encodeURIComponent(state.token)}&limit=30`;
            const resp = await apiFetch(url, 'GET');
            // Support both old format (array) and new (paginated object)
            const msgs = Array.isArray(resp) ? resp : (resp.messages || []);
            if (msgs && msgs.length) {
                const existingIds = new Set(
                    Array.from(messagesEl.querySelectorAll('.mai-message[data-id]')).map(el => parseInt(el.dataset.id, 10))
                );
                msgs.forEach(msg => {
                    if (!existingIds.has(msg.id)) {
                        appendMessage(msg);
                    }
                });
                state.lastPollTime = msgs[msgs.length - 1].created_at;
                state.oldestMsgId  = msgs[0].id;
            }
            scrollToBottom();
            startPolling();
            initInfiniteScroll();
        } catch (e) {
            // Token expired or conversation gone — start fresh
            state.conversationId = null;
            state.token = null;
            state.lastPollTime = null;
            saveSession();
            messagesEl.innerHTML = '';
            startConversation();
        }
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

        // Avatar
        const avatar = createAvatarEl(msg.sender_type);

        // Content wrapper
        const content = document.createElement('div');
        content.className = 'mai-msg-content';

        const bubble = document.createElement('div');
        bubble.className = 'mai-bubble';
        bubble.textContent = msg.content;

        const meta = document.createElement('div');
        meta.className = 'mai-msg-meta';
        meta.textContent = (msg.sender_type === 'visitor' ? 'You' : (cfg.agentName || 'Support')) + ' \u00B7 ' + formatTime(msg.created_at);

        content.appendChild(bubble);
        content.appendChild(meta);

        // Quick reply chips
        if (msg.quick_replies && msg.quick_replies.length && msg.sender_type !== 'visitor') {
            const qrEl = renderQuickReplies(msg.quick_replies);
            content.appendChild(qrEl);
        }

        wrap.appendChild(avatar);
        wrap.appendChild(content);

        messagesEl.appendChild(wrap);
        scrollToBottom();
    }

    function appendSystemMsg(text) {
        const el = document.createElement('div');
        el.style.cssText = 'text-align:center;font-size:12px;color:var(--mai-muted);padding:6px 0;';
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

        // Avatar
        const avatar = createAvatarEl('ai');

        // Content wrapper
        const content = document.createElement('div');
        content.className = 'mai-msg-content';

        const bubble = document.createElement('div');
        bubble.className = 'mai-bubble';
        bubble.textContent = '';

        content.appendChild(bubble);
        wrap.appendChild(avatar);
        wrap.appendChild(content);
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

        // Stop polling BEFORE posting to prevent race condition where a poll
        // picks up the server-side message before we can track its ID.
        stopPolling();

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
            startPolling();
            return;
        }

        // Only show typing and open SSE stream if AI auto-reply is enabled
        if (cfg.autoReply !== false) {
            typingEl.hidden = false;
            scrollToBottom();
            openStream();
        } else {
            sendBtn.disabled = false;
            state.lastPollTime = new Date().toISOString();
            startPolling();
        }
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
                        const content = wrap.querySelector('.mai-msg-content');
                        if (content) {
                            const meta = document.createElement('div');
                            meta.className = 'mai-msg-meta';
                            meta.textContent = (cfg.agentName || 'Support') + ' \u00B7 ' + formatTime(null);
                            content.appendChild(meta);
                        }
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
                const wrap = document.getElementById('mai-streaming-bubble');
                if (wrap) {
                    const content = wrap.querySelector('.mai-msg-content');
                    if (content && !content.querySelector('.mai-quick-replies')) {
                        content.appendChild(renderQuickReplies(data.quick_replies));
                    }
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
            const resp  = await apiFetch(url, 'GET');
            // Support both array (polling/since) and paginated object
            const msgs  = Array.isArray(resp) ? resp : (resp.messages || resp || []);
            if (!msgs || !msgs.length) return;

            const existingIds = new Set(
                Array.from(messagesEl.querySelectorAll('.mai-message[data-id]')).map(el => parseInt(el.dataset.id, 10))
            );

            // Also collect content of optimistically rendered visitor messages
            // (those with large Date.now()-style IDs) for content-based dedup.
            const optimisticTexts = new Set();
            messagesEl.querySelectorAll('.mai-from-visitor[data-id]').forEach(el => {
                const id = parseInt(el.dataset.id, 10);
                if (id > 1000000) {
                    const bubble = el.querySelector('.mai-bubble');
                    if (bubble) optimisticTexts.add(bubble.textContent);
                }
            });

            msgs.forEach(msg => {
                if (existingIds.has(msg.id)) return;
                // Skip visitor messages that match an optimistic render
                if (msg.sender_type === 'visitor' && optimisticTexts.has(msg.content)) {
                    // Replace the optimistic ID with the real server ID
                    const optEl = Array.from(messagesEl.querySelectorAll('.mai-from-visitor[data-id]'))
                        .find(el => parseInt(el.dataset.id, 10) > 1000000 && el.querySelector('.mai-bubble')?.textContent === msg.content);
                    if (optEl) optEl.dataset.id = msg.id;
                    optimisticTexts.delete(msg.content);
                    return;
                }
                appendMessage(msg);
                if (msg.sender_type !== 'visitor') {
                    if (!state.open) showUnread();
                    fireNotification(msg.content);
                }
            });

            if (msgs.length) {
                state.lastPollTime = msgs[msgs.length - 1].created_at;
                if (!state.oldestMsgId || msgs[0].id < state.oldestMsgId) {
                    state.oldestMsgId = msgs[0].id;
                }
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
            submitBtn.textContent = 'Sending\u2026';

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
    // Infinite scroll (load older messages)
    // -------------------------------------------------------------------------
    function initInfiniteScroll() {
        if (!messagesEl) return;
        messagesEl.addEventListener('scroll', () => {
            if (messagesEl.scrollTop < 60 && !state.loadingOlder && state.oldestMsgId) {
                loadOlderMessages();
            }
        });
    }

    async function loadOlderMessages() {
        if (state.loadingOlder || !state.conversationId || !state.oldestMsgId) return;
        state.loadingOlder = true;

        try {
            const url = `${API}/conversations/${state.conversationId}/messages?token=${encodeURIComponent(state.token)}&before=${state.oldestMsgId}&limit=20`;
            const resp = await apiFetch(url, 'GET');
            const msgs = resp.messages || [];

            if (!msgs.length || !resp.has_older) {
                state.oldestMsgId = null; // no more older messages
            }

            if (msgs.length) {
                const prevHeight = messagesEl.scrollHeight;
                const prevTop    = messagesEl.scrollTop;

                // Prepend messages in order (msgs are already chronological)
                const firstChild = messagesEl.firstChild;
                msgs.forEach(msg => {
                    const wrap = buildMessageEl(msg);
                    messagesEl.insertBefore(wrap, firstChild);
                });

                state.oldestMsgId = msgs[0].id;

                // Restore scroll so user doesn't jump
                const newHeight = messagesEl.scrollHeight;
                messagesEl.scrollTop = prevTop + (newHeight - prevHeight);
            }
        } catch (e) {
            // silent
        }
        state.loadingOlder = false;
    }

    /** Build a message DOM element (used for prepending older messages) */
    function buildMessageEl(msg) {
        const wrap = document.createElement('div');
        wrap.className = `mai-message mai-from-${msg.sender_type}`;
        wrap.dataset.id = msg.id;

        const avatar = createAvatarEl(msg.sender_type);
        const content = document.createElement('div');
        content.className = 'mai-msg-content';

        const bubble = document.createElement('div');
        bubble.className = 'mai-bubble';
        bubble.textContent = msg.content;

        const meta = document.createElement('div');
        meta.className = 'mai-msg-meta';
        meta.textContent = (msg.sender_type === 'visitor' ? 'You' : (cfg.agentName || 'Support')) + ' \u00B7 ' + formatTime(msg.created_at);

        content.appendChild(bubble);
        content.appendChild(meta);

        if (msg.quick_replies && msg.quick_replies.length && msg.sender_type !== 'visitor') {
            content.appendChild(renderQuickReplies(msg.quick_replies));
        }

        wrap.appendChild(avatar);
        wrap.appendChild(content);
        return wrap;
    }

    // -------------------------------------------------------------------------
    // Auto-grow textarea
    // -------------------------------------------------------------------------
    function autoGrow(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 80) + 'px';
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
