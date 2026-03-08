/**
 * Michelle AI — Public Chat Widget
 * Vanilla JS, no dependencies.
 *
 * Calls Supabase Edge Functions directly (no WordPress proxy).
 * Config injected via wp_localize_script as window.michelleAICfg.
 */
(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Config injected by wp_localize_script (michelleAICfg)
    // -------------------------------------------------------------------------
    const cfg = window.michelleAICfg || {};
    const SUPABASE_URL = cfg.supabaseUrl || '';  // e.g. http://127.0.0.1:54421
    const FUNCTIONS_URL = SUPABASE_URL + '/functions/v1';
    const REST_URL = cfg.restUrl || '';  // WP REST API base
    const chatEnabled = !!cfg.chatEnabled;

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
        audioActive:    false,
        audioScriptLoaded: false,
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

    /** Lightweight markdown → HTML (escapes first to prevent XSS). */
    function renderMd(str) {
        let html = esc(str);
        // Bold: **text**
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* (but not inside bold)
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Inline code: `text`
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
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
        playMessageSound();
        if (!state.notifGranted || document.hasFocus()) return;
        const n = new Notification(cfg.widgetTitle || 'New message', {
            body: text,
            icon: cfg.logoUrl || '',
        });
        n.onclick = () => { window.focus(); openWidget(); n.close(); };
        setTimeout(() => n.close(), 6000);
    }

    /** Soft three-note chime (G5 → B5 → D6) — gentler than the admin alert. */
    function playMessageSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const gain = ctx.createGain();
            gain.connect(ctx.destination);

            [784, 988, 1175].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = freq;
                osc.connect(gain);
                const t = ctx.currentTime + i * 0.12;
                gain.gain.setValueAtTime(0.15, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
                osc.start(t);
                osc.stop(t + 0.25);
            });
        } catch (e) {}
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
        if (state.audioActive) stopAudio();
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
     * If the token is expired (401/403), start a fresh conversation instead.
     */
    async function resumeSession() {
        try {
            const url = `${FUNCTIONS_URL}/messages?conversation_id=${state.conversationId}&limit=30`;
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
                // Only enable infinite scroll if there are older messages
                state.oldestMsgId  = resp.has_older ? msgs[0].id : null;
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
            const res = await apiFetch(`${FUNCTIONS_URL}/conversations`, 'POST', {});
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
    function hideWelcome() {
        const w = document.getElementById('mai-welcome');
        if (w) w.remove();
    }

    function appendMessage(msg) {
        hideWelcome();

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
        bubble.innerHTML = renderMd(msg.content);

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

        // POST to Edge Function
        try {
            await apiFetch(`${FUNCTIONS_URL}/messages`, 'POST', {
                content: text,
                conversation_id: state.conversationId,
            });
        } catch(e) {
            appendSystemMsg('Failed to send message.');
            sendBtn.disabled = false;
            startPolling();
            return;
        }

        // Only show typing and open SSE stream if AI auto-reply is enabled
        if (cfg.autoReply) {
            typingEl.hidden = false;
            scrollToBottom();
            openStream();
        } else {
            sendBtn.disabled = false;
            startPolling();
        }
    }

    // -------------------------------------------------------------------------
    // SSE stream (AI response) — fetch-based for POST support
    // -------------------------------------------------------------------------
    async function openStream() {
        state.streaming = true;
        stopPolling();     // pause polling while streaming

        let bubble = null;
        let fullText = '';

        try {
            const res = await fetch(`${FUNCTIONS_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Chat-Token': state.token || '',
                },
                body: JSON.stringify({
                    conversation_id: state.conversationId,
                }),
            });

            if (!res.ok) {
                throw new Error('Stream request failed');
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE lines from the buffer
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6);

                    let data;
                    if (payload === '[DONE]') {
                        data = { done: true };
                    } else {
                        try { data = JSON.parse(payload); }
                        catch { continue; }
                    }

                    if (data.done) {
                        typingEl.hidden = true;
                        state.streaming = false;
                        sendBtn.disabled = false;

                        // Tag the streaming bubble with the server message ID for dedup
                        if (bubble) {
                            const wrap = document.getElementById('mai-streaming-bubble');
                            if (wrap) {
                                if (data.msg_id) wrap.dataset.id = data.msg_id;
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
                        // Don't break — there may be quick_replies after done
                        continue;
                    }

                    if (data.token !== undefined) {
                        if (!bubble) {
                            typingEl.hidden = true;
                            bubble = createStreamingBubble();
                        }
                        fullText += data.token;
                        bubble.innerHTML = renderMd(fullText);
                        scrollToBottom();
                    }

                    if (data.quick_replies && data.quick_replies.length) {
                        const wrap = document.getElementById('mai-streaming-bubble') ||
                                     (bubble && bubble.closest('.mai-message'));
                        if (wrap) {
                            const content = wrap.querySelector('.mai-msg-content');
                            if (content && !content.querySelector('.mai-quick-replies')) {
                                content.appendChild(renderQuickReplies(data.quick_replies));
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Stream error:', e);
        }

        // Ensure we clean up state even if stream ended without a done event
        typingEl.hidden = true;
        state.streaming = false;
        sendBtn.disabled = false;
        startPolling();
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
            let url = `${FUNCTIONS_URL}/messages?conversation_id=${state.conversationId}`;
            if (!all && state.lastPollTime) {
                url += '&since=' + encodeURIComponent(state.lastPollTime);
            }
            const resp = await apiFetch(url, 'GET');
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
                const url = REST_URL ? `${REST_URL}/contact` : `${FUNCTIONS_URL}/contacts`;
                const res = await apiFetch(url, 'POST', data);
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
    async function apiFetch(url, method, body) {
        const opts = {
            method:  method || 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        if (state.token) opts.headers['X-Chat-Token'] = state.token;
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        const json = await res.json();

        if (!res.ok) {
            throw new Error(json.message || json.error || 'Request failed');
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
            const url = `${FUNCTIONS_URL}/messages?conversation_id=${state.conversationId}&before=${state.oldestMsgId}&limit=20`;
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
        bubble.innerHTML = renderMd(msg.content);

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
    // Audio conversations (ElevenLabs SDK + canvas waveform)
    // -------------------------------------------------------------------------
    let audioConversation = null;
    let audioAnimFrame    = null;
    let audioMode         = 'listening'; // 'listening' | 'speaking'
    let audioMuted        = false;

    async function loadElevenLabsSDK() {
        if (state.audioScriptLoaded && window.__ElevenLabsConversation) return;
        // Dynamic ESM import from CDN
        const mod = await import('https://cdn.jsdelivr.net/npm/@11labs/client@latest/+esm');
        window.__ElevenLabsConversation = mod.Conversation;
        state.audioScriptLoaded = true;
    }

    // Track the streaming agent bubble during audio transcription
    let audioAgentBubble = null;
    let audioAgentText   = '';
    let audioTranscripts = [];  // Buffer for saving transcripts to DB

    /**
     * Collect existing chat messages from the DOM for passing as context
     * to the audio agent so it knows what's been discussed.
     */
    function collectChatHistory() {
        const msgEls = messagesEl.querySelectorAll('.mai-message');
        const lines = [];
        msgEls.forEach(el => {
            const bubble = el.querySelector('.mai-bubble');
            if (!bubble) return;
            const text = bubble.textContent.trim();
            if (!text) return;
            const isVisitor = el.classList.contains('mai-from-visitor');
            lines.push((isVisitor ? 'User' : 'Agent') + ': ' + text);
        });
        return lines.join('\n');
    }

    async function startAudio() {
        const panel     = document.getElementById('mai-audio-panel');
        const audioBtn  = document.getElementById('mai-audio-btn');
        const modeEl    = document.getElementById('mai-audio-mode');
        const modeLabel = document.getElementById('mai-mode-label');
        if (!panel) return;

        // Mark as active but don't show panel yet — wait for onConnect
        state.audioActive = true;
        audioTranscripts = [];
        if (audioBtn) audioBtn.classList.add('mai-audio-active');

        try {
            // Request mic permission upfront
            await navigator.mediaDevices.getUserMedia({ audio: true });

            // Fetch signed URL from Edge Function
            const res = await apiFetch(`${FUNCTIONS_URL}/audio-signed-url`, 'GET');

            // Load SDK
            await loadElevenLabsSDK();
            const Conversation = window.__ElevenLabsConversation;

            // Collect prior chat history to pass as context
            const chatHistory = collectChatHistory();

            // Start the conversation session
            const sessionOpts = {
                onConnect: () => {
                    // NOW show the audio bar and hide the text input
                    panel.hidden = false;
                    document.querySelector('.mai-input-area')?.classList.add('mai-hidden');
                    if (modeLabel) modeLabel.textContent = 'Listening...';
                    if (modeEl) modeEl.dataset.mode = 'listening';
                    audioMode = 'listening';
                    startWaveform();
                },
                onDisconnect: () => {
                    stopAudio();
                },
                onModeChange: (mode) => {
                    audioMode = mode.mode;
                    if (modeLabel) {
                        modeLabel.textContent = audioMode === 'speaking' ? 'Speaking...' : 'Listening...';
                    }
                    if (modeEl) modeEl.dataset.mode = audioMode;

                    // When agent stops speaking, finalize any in-progress agent bubble
                    if (audioMode === 'listening' && audioAgentBubble) {
                        finalizeAudioAgentBubble();
                    }
                },
                onMessage: (data) => {
                    handleAudioTranscript(data);
                },
                onError: (err) => {
                    console.error('Audio session error:', err);
                    if (modeLabel) modeLabel.textContent = 'Connection lost';
                    if (modeEl) modeEl.dataset.mode = 'error';
                },
            };

            // Pass prior chat history so the voice agent has full context
            if (chatHistory) {
                sessionOpts.dynamicVariables = {
                    conversation_history: chatHistory,
                };
            }

            if (res.signed_url) {
                sessionOpts.signedUrl = res.signed_url;
            } else if (res.agent_id) {
                sessionOpts.agentId = res.agent_id;
            }

            audioConversation = await Conversation.startSession(sessionOpts);
            audioMuted = false;

        } catch (err) {
            console.error('Failed to start audio:', err);
            // If panel was never shown (connection failed), clean up
            stopAudio();
        }
    }

    /**
     * Handle real-time transcript messages from the audio session.
     * source: "ai" (agent) or "user" (caller)
     */
    function handleAudioTranscript(data) {
        const { source, message } = data;
        if (!message || !message.trim()) return;

        if (source === 'user') {
            // Finalize any pending agent bubble first
            if (audioAgentBubble) finalizeAudioAgentBubble();

            // Append user transcript as a visitor bubble
            appendMessage({
                id:          Date.now(),
                sender_type: 'visitor',
                content:     message,
                created_at:  new Date().toISOString(),
            });

            // Buffer for DB persistence
            audioTranscripts.push({ sender_type: 'visitor', content: message });
        } else if (source === 'ai') {
            // Agent transcript — update or create a streaming bubble
            if (!audioAgentBubble) {
                audioAgentText = message;
                audioAgentBubble = createStreamingBubble();
                audioAgentBubble.innerHTML = renderMd(message);
            } else {
                audioAgentText = message;
                audioAgentBubble.innerHTML = renderMd(message);
            }
            scrollToBottom();
        }
    }

    /** Finalize the current agent streaming bubble with a timestamp */
    function finalizeAudioAgentBubble() {
        if (!audioAgentBubble) return;
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
        // Buffer the finalized agent message for DB persistence
        if (audioAgentText) {
            audioTranscripts.push({ sender_type: 'ai', content: audioAgentText });
        }
        audioAgentBubble = null;
        audioAgentText   = '';
    }

    function stopAudio() {
        const panel    = document.getElementById('mai-audio-panel');
        const audioBtn = document.getElementById('mai-audio-btn');

        // Stop waveform animation
        if (audioAnimFrame) {
            cancelAnimationFrame(audioAnimFrame);
            audioAnimFrame = null;
        }

        // End the SDK session
        if (audioConversation) {
            try { audioConversation.endSession(); } catch (e) {}
            audioConversation = null;
        }

        // Finalize any pending agent bubble
        if (audioAgentBubble) finalizeAudioAgentBubble();

        // Persist audio transcripts to the database
        saveAudioTranscripts();

        state.audioActive = false;
        audioMuted = false;

        if (panel) panel.hidden = true;

        // Restore text input
        document.querySelector('.mai-input-area')?.classList.remove('mai-hidden');
        if (audioBtn) audioBtn.classList.remove('mai-audio-active');

        // Reset mute button
        const muteBtn = document.getElementById('mai-audio-mute');
        if (muteBtn) {
            muteBtn.classList.remove('mai-muted');
        }

        requestAnimationFrame(() => scrollToBottom());
    }

    /** Batch-save buffered audio transcripts to the server */
    function saveAudioTranscripts() {
        if (!audioTranscripts.length || !state.conversationId) return;
        const messages = audioTranscripts.slice();
        audioTranscripts = [];
        // Save each transcript as a message via Edge Function
        Promise.all(messages.map(msg =>
            apiFetch(`${FUNCTIONS_URL}/messages`, 'POST', {
                content: msg.content,
                conversation_id: state.conversationId,
            }).catch(err => console.warn('Failed to save audio transcript:', err))
        ));
    }

    function toggleMute() {
        if (!audioConversation) return;
        audioMuted = !audioMuted;
        audioConversation.setMicMuted(audioMuted);

        const muteBtn = document.getElementById('mai-audio-mute');
        if (muteBtn) {
            muteBtn.classList.toggle('mai-muted', audioMuted);
            muteBtn.title = audioMuted ? 'Unmute' : 'Mute';
            muteBtn.setAttribute('aria-label', audioMuted ? 'Unmute microphone' : 'Mute microphone');
        }
    }

    // -- Canvas waveform visualization ----------------------------------------
    function startWaveform() {
        const canvas = document.getElementById('mai-waveform');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        function resize() {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width  = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width  = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            ctx.scale(dpr, dpr);
        }
        resize();

        const primaryColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--mai-primary').trim() || '#2563eb';

        function draw() {
            audioAnimFrame = requestAnimationFrame(draw);

            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            ctx.clearRect(0, 0, w, h);

            if (!audioConversation) return;

            // Get frequency data based on current mode
            let freqData;
            try {
                freqData = audioMode === 'speaking'
                    ? audioConversation.getOutputByteFrequencyData()
                    : audioConversation.getInputByteFrequencyData();
            } catch (e) {
                return;
            }

            if (!freqData || !freqData.length) {
                // Fallback: draw idle pulse using volume
                let vol = 0;
                try {
                    vol = audioMode === 'speaking'
                        ? audioConversation.getOutputVolume()
                        : audioConversation.getInputVolume();
                } catch (e) {}
                drawIdlePulse(ctx, w, h, vol, primaryColor);
                return;
            }

            drawFrequencyBars(ctx, freqData, w, h, primaryColor);
        }

        draw();
    }

    function drawFrequencyBars(ctx, data, w, h, color) {
        const barWidth = 3;
        const gap      = 2;
        const totalBarW = barWidth + gap;
        const barCount = Math.min(Math.floor(w / totalBarW), data.length);
        const startIdx = Math.floor((data.length - barCount) / 2);
        const startX   = (w - barCount * totalBarW) / 2;
        const centerY  = h / 2;
        const maxBarH  = h * 0.8;

        // Parse color for alpha
        ctx.fillStyle = color;

        for (let i = 0; i < barCount; i++) {
            const val = data[startIdx + i] / 255;
            const barH = Math.max(2, val * maxBarH);

            // Fade edges
            const progress = i / barCount;
            const edgeFade = Math.min(progress * 4, (1 - progress) * 4, 1);

            ctx.globalAlpha = 0.3 + val * 0.7 * edgeFade;
            const x = startX + i * totalBarW;
            const radius = barWidth / 2;

            // Draw rounded bar (symmetric from center)
            roundRect(ctx, x, centerY - barH / 2, barWidth, barH, radius);
        }
        ctx.globalAlpha = 1;
    }

    function drawIdlePulse(ctx, w, h, volume, color) {
        const centerY = h / 2;
        const barWidth = 3;
        const gap = 2;
        const barCount = 32;
        const totalW = barCount * (barWidth + gap);
        const startX = (w - totalW) / 2;

        ctx.fillStyle = color;

        for (let i = 0; i < barCount; i++) {
            // Create gentle sine wave + volume response
            const t = Date.now() / 600;
            const progress = i / barCount;
            const sine = Math.sin(t + i * 0.3) * 0.5 + 0.5;
            const edgeFade = Math.min(progress * 4, (1 - progress) * 4, 1);
            const barH = Math.max(2, (2 + sine * 8 + volume * 30) * edgeFade);

            ctx.globalAlpha = 0.2 + sine * 0.3 * edgeFade;
            roundRect(ctx, startX + i * (barWidth + gap), centerY - barH / 2, barWidth, barH, barWidth / 2);
        }
        ctx.globalAlpha = 1;
    }

    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
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

        // Audio buttons
        document.getElementById('mai-audio-btn')?.addEventListener('click', () => {
            if (state.audioActive) stopAudio();
            else startAudio();
        });
        document.getElementById('mai-audio-end')?.addEventListener('click', stopAudio);
        document.getElementById('mai-audio-mute')?.addEventListener('click', toggleMute);

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
