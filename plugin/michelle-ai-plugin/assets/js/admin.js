/**
 * Michelle AI — Admin JS
 * Handles: tab switching, settings save, conversation polling,
 *          admin reply, AI suggested reply, approve, browser notifications.
 */
(function ($) {
    'use strict';

    const cfg    = window.michelleAIAdmin || {};
    const API    = cfg.restUrl  || '';
    const nonce  = cfg.nonce    || '';
    const sound  = cfg.notifSound !== false;

    // -------------------------------------------------------------------------
    // Tabs
    // -------------------------------------------------------------------------
    function initTabs() {
        const tabs   = document.querySelectorAll('.mai-tab');
        const panels = document.querySelectorAll('.mai-tab-panel');
        if (!tabs.length) return;

        // Activate from hash
        const hash = location.hash.replace('#', '');
        if (hash) activate(hash);

        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                activate(tab.dataset.tab);
                history.replaceState(null, '', '#' + tab.dataset.tab);
            });
        });

        function activate(id) {
            tabs.forEach(t => t.classList.toggle('mai-tab-active', t.dataset.tab === id));
            panels.forEach(p => { p.hidden = p.id !== 'mai-tab-' + id; });
        }
    }

    // -------------------------------------------------------------------------
    // Temperature slider
    // -------------------------------------------------------------------------
    function initTemperature() {
        const slider = document.getElementById('temperature');
        const output = document.getElementById('temperature_output');
        if (!slider || !output) return;
        slider.addEventListener('input', () => { output.value = slider.value; });
    }

    // -------------------------------------------------------------------------
    // Settings save (AJAX via REST)
    // -------------------------------------------------------------------------
    function initSettingsForm() {
        const form = document.getElementById('mai-settings-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn    = document.getElementById('mai-save-settings');
            const notice = document.getElementById('mai-settings-saved');
            btn.disabled = true;
            btn.textContent = 'Saving…';

            // Collect all form fields into an object
            const data = {};
            new FormData(form).forEach((val, key) => {
                if (key === 'mai_settings_nonce') return;
                // Handle checkboxes: unchecked ones won't appear in FormData
                data[key] = val;
            });
            // Explicitly handle unchecked checkboxes
            ['widget_visible','chat_enabled','auto_reply','moderation_mode','notification_sound','extraction_enabled','audio_enabled'].forEach(k => {
                if (!(k in data)) data[k] = false;
                else data[k] = true;
            });
            // Numeric fields
            if (data.context_messages) data.context_messages = parseInt(data.context_messages, 10);
            if (data.temperature)      data.temperature      = parseFloat(data.temperature);

            // Collect extraction properties from dynamic rows
            data.extraction_properties = collectExtractionProps();

            // Collect document templates
            data.document_templates = collectDocumentTemplates();

            try {
                await apiPost('/admin/settings', data);
                notice.hidden = false;
                setTimeout(() => { notice.hidden = true; }, 3000);
            } catch(err) {
                alert('Error saving settings: ' + err.message);
            }

            btn.disabled = false;
            btn.textContent = 'Save Settings';
        });
    }

    // -------------------------------------------------------------------------
    // Autoscroll + infinite scroll for conversation messages
    // -------------------------------------------------------------------------
    function initMessageScroll() {
        const thread = document.getElementById('mai-detail-messages');
        if (!thread) return;

        // Scroll to bottom after browser finishes layout
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                thread.scrollTop = thread.scrollHeight;
            });
        });

        // "Load older" button
        const loadBtn = document.getElementById('mai-load-older-btn');
        if (!loadBtn) return;

        const convId = parseInt(thread.dataset.convId, 10);
        let loading = false;

        async function loadOlder() {
            if (loading) return;
            loading = true;
            loadBtn.textContent = 'Loading…';

            // Find the oldest message ID currently in the thread
            const firstBubble = thread.querySelector('.mai-admin-bubble[data-msg-id]');
            if (!firstBubble) { loading = false; return; }
            const beforeId = parseInt(firstBubble.dataset.msgId, 10);

            try {
                const res = await apiGet(`/admin/conversations/${convId}/messages?before=${beforeId}&limit=30`);
                const msgs = res.messages || [];
                if (!msgs.length || !res.has_older) {
                    // No more older messages
                    document.getElementById('mai-load-older')?.remove();
                }
                if (msgs.length) {
                    // Remember scroll position so we can keep the view stable
                    const prevHeight = thread.scrollHeight;
                    const prevTop    = thread.scrollTop;

                    // Insert messages before the first existing bubble
                    const anchor = document.getElementById('mai-load-older');
                    const visitorName = thread.dataset.visitorName || 'Anonymous';
                    msgs.forEach(msg => {
                        const el = buildAdminBubbleEl(msg, visitorName);
                        if (anchor && anchor.nextSibling) {
                            thread.insertBefore(el, anchor.nextSibling);
                        } else {
                            thread.insertBefore(el, firstBubble);
                        }
                    });

                    // Restore scroll position so user doesn't jump
                    const newHeight = thread.scrollHeight;
                    thread.scrollTop = prevTop + (newHeight - prevHeight);
                }
                if (msgs.length && res.has_older) {
                    loadBtn.textContent = 'Load older messages…';
                }
            } catch (e) {
                loadBtn.textContent = 'Load older messages…';
            }
            loading = false;
        }

        loadBtn.addEventListener('click', loadOlder);

        // Also trigger on scroll to top (infinite scroll)
        thread.addEventListener('scroll', () => {
            if (thread.scrollTop < 80 && !loading && document.getElementById('mai-load-older')) {
                loadOlder();
            }
        });
    }

    function buildAdminBubbleEl(msg, visitorName) {
        const isPending = msg.is_pending_mod;
        let cls = 'mai-admin-bubble mai-bubble-' + msg.sender_type;
        if (isPending) cls += ' mai-bubble-pending';

        const el = document.createElement('div');
        el.className = cls;
        el.dataset.msgId = msg.id;

        let senderLabel;
        if (msg.sender_type === 'visitor') senderLabel = escHtml(visitorName);
        else if (msg.sender_type === 'ai') senderLabel = 'AI';
        else senderLabel = 'Admin';

        const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

        let html = `<div class="mai-bubble-sender">${senderLabel} <span class="mai-bubble-time">${escHtml(time)}</span>`;
        if (isPending) html += ` <span class="mai-pending-label">Pending approval</span>`;
        html += `</div><div class="mai-bubble-text">${escHtml(msg.content)}</div>`;

        if (isPending) {
            html += `<button class="button mai-approve-btn" data-msg-id="${msg.id}">✓ Approve &amp; Send</button>`;
        }

        if (msg.quick_replies && msg.quick_replies.length) {
            html += `<div class="mai-admin-qr-list"><span>Quick replies offered to visitor:</span>`;
            msg.quick_replies.forEach(qr => {
                html += `<span class="mai-admin-qr-chip">${escHtml(qr)}</span>`;
            });
            html += `</div>`;
        }

        el.innerHTML = html;
        return el;
    }

    // -------------------------------------------------------------------------
    // Admin reply
    // -------------------------------------------------------------------------
    function initReply() {
        const sendBtn = document.getElementById('mai-admin-send-btn');
        if (!sendBtn) return;

        const convId  = parseInt(sendBtn.dataset.convId, 10);
        const input   = document.getElementById('mai-admin-reply');

        sendBtn.addEventListener('click', () => sendAdminMessage(convId, input));
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdminMessage(convId, input); }
        });
    }

    async function sendAdminMessage(convId, input) {
        const text = input?.value?.trim();
        if (!text) return;
        try {
            input.value = '';
            const res = await apiPost(`/admin/conversations/${convId}/messages`, { content: text });
            appendAdminBubble(text, res.msg_id);
        } catch(err) {
            alert('Failed to send: ' + err.message);
        }
    }

    function appendAdminBubble(text, msgId) {
        const thread = document.getElementById('mai-detail-messages');
        if (!thread) return;
        const el = document.createElement('div');
        el.className = 'mai-admin-bubble mai-bubble-admin';
        if (msgId) el.dataset.msgId = msgId;
        el.innerHTML = `<div class="mai-bubble-sender">Admin <span class="mai-bubble-time">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div><div class="mai-bubble-text">${escHtml(text)}</div>`;
        thread.appendChild(el);
        thread.scrollTop = thread.scrollHeight;

        // Register in detail polling's known IDs so it won't be duplicated
        if (msgId && detailKnownIds) detailKnownIds.add(msgId);
    }

    // -------------------------------------------------------------------------
    // AI Suggested reply
    // -------------------------------------------------------------------------
    function initSuggestedReply() {
        const regenBtn = document.getElementById('mai-regenerate-btn');
        const useBtn   = document.getElementById('mai-use-suggestion-btn');
        const textarea = document.getElementById('mai-suggestion-text');
        const box      = document.querySelector('.mai-suggestion-box');
        const toggle   = document.getElementById('mai-suggestion-toggle');
        if (!regenBtn || !useBtn || !textarea) return;

        const convId = parseInt(regenBtn.dataset.convId, 10);

        // Toggle collapse/expand
        if (toggle && box) {
            toggle.addEventListener('click', () => {
                box.classList.toggle('mai-suggestion-collapsed');
                const label = toggle.querySelector('span');
                if (label) {
                    const isCollapsed = box.classList.contains('mai-suggestion-collapsed');
                    label.textContent = (isCollapsed ? '▸ ' : '▾ ') + 'AI Suggested Reply';
                }
            });
        }

        regenBtn.addEventListener('click', async (e) => {
            // Auto-expand when generating
            if (box) {
                box.classList.remove('mai-suggestion-collapsed');
                const label = toggle?.querySelector('span');
                if (label) label.textContent = '▾ AI Suggested Reply';
            }
            regenBtn.textContent = '↻ Loading…';
            regenBtn.disabled = true;
            try {
                const res = await apiPost(`/admin/conversations/${convId}/suggest`, {});
                textarea.value = res.suggestion || '';
            } catch(err) {
                alert('Could not generate suggestion: ' + err.message);
            }
            regenBtn.textContent = '↻ Regenerate';
            regenBtn.disabled = false;
        });

        useBtn.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (!text) return;
            const input = document.getElementById('mai-admin-reply');
            if (input) {
                input.value = text;
                input.focus();
            }
            // Auto-send
            await sendAdminMessage(convId, { value: text, _used: true });
            // Provide a fresh textarea ref after use
            if (input) input.value = '';
            textarea.value = '';
        });
    }

    // -------------------------------------------------------------------------
    // Approve pending messages
    // -------------------------------------------------------------------------
    function initApprove() {
        document.addEventListener('click', async (e) => {
            if (!e.target.matches('.mai-approve-btn')) return;
            const btn   = e.target;
            const msgId = parseInt(btn.dataset.msgId, 10);
            btn.disabled = true;
            btn.textContent = 'Approving…';
            try {
                await apiPost(`/admin/messages/${msgId}/approve`, {});
                btn.closest('.mai-admin-bubble').classList.remove('mai-bubble-pending');
                btn.closest('.mai-admin-bubble').querySelector('.mai-pending-label')?.remove();
                btn.remove();
            } catch(err) {
                btn.disabled = false;
                btn.textContent = '✓ Approve & Send';
                alert('Failed to approve: ' + err.message);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Conversation status change
    // -------------------------------------------------------------------------
    function initDocTemplateSelect() {
        const tplSel = document.getElementById('mai-doc-template-select');
        const pdfBtn = document.getElementById('mai-generate-pdf-btn');
        if (!tplSel || !pdfBtn) return;
        tplSel.addEventListener('change', () => {
            const url = new URL(pdfBtn.href);
            url.searchParams.set('template', tplSel.value);
            pdfBtn.href = url.toString();
        });
    }

    function initStatusSelect() {
        const sel = document.getElementById('mai-status-select');
        if (!sel) return;
        const convId = parseInt(sel.dataset.convId, 10);
        sel.addEventListener('change', async () => {
            try {
                await apiPatch(`/admin/conversations/${convId}`, { status: sel.value });
            } catch(err) {
                alert('Failed to update status: ' + err.message);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Auto-generate suggestion + refresh extracted data
    // -------------------------------------------------------------------------
    async function autoGenerateSuggestion(convId) {
        const textarea = document.getElementById('mai-suggestion-text');
        const regenBtn = document.getElementById('mai-regenerate-btn');
        if (!textarea || !regenBtn) return;
        regenBtn.textContent = '↻ Loading…';
        regenBtn.disabled = true;
        try {
            const res = await apiPost(`/admin/conversations/${convId}/suggest`, {});
            textarea.value = res.suggestion || '';
        } catch(e) {
            // silent — admin can still click Regenerate manually
        }
        regenBtn.textContent = '↻ Regenerate';
        regenBtn.disabled = false;
    }

    function updateExtractedData(data) {
        if (!data || !Object.keys(data).length) return;
        const labels = cfg.propLabels || {};
        // Build or update the extracted data table
        let table = document.querySelector('.mai-extracted-table');
        if (!table) {
            // Create the section if it doesn't exist yet
            const section = document.createElement('div');
            section.className = 'mai-extracted-data';
            section.innerHTML = '<h4>Extracted Data</h4><table class="mai-extracted-table"></table>';
            const header = document.querySelector('.mai-detail-header');
            if (header) header.after(section);
            table = section.querySelector('.mai-extracted-table');
        }
        // Replace table contents with latest data
        table.innerHTML = '';
        for (const [key, val] of Object.entries(data)) {
            const tr = document.createElement('tr');
            const label = labels[key] || key;
            tr.innerHTML = `<td>${escHtml(label)}</td><td>${escHtml(val)}</td>`;
            table.appendChild(tr);
        }
    }

    // -------------------------------------------------------------------------
    // Admin polling (new conversations / messages)
    // -------------------------------------------------------------------------
    let lastKnownConvs   = new Set();
    let adminPollTimer   = null;
    let notifGranted     = false;
    let detailKnownIds   = null;  // Set of message IDs in the detail view

    function initAdminPolling() {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                notifGranted = true;
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(p => { notifGranted = p === 'granted'; });
            }
        }

        // Poll the conversation list page
        if (document.querySelector('.mai-conv-list')) {
            document.querySelectorAll('.mai-conv-item').forEach(el => {
                lastKnownConvs.add(parseInt(el.dataset.id, 10));
            });
            adminPollTimer = setInterval(pollConversations, 3000);

            // Show loading spinner in detail pane when switching conversations
            document.querySelector('.mai-conv-list').addEventListener('click', (e) => {
                const item = e.target.closest('.mai-conv-item');
                if (!item) return;
                const detail = document.getElementById('mai-conv-detail');
                if (detail) {
                    detail.innerHTML = '<div class="mai-detail-loading"><span class="mai-spinner"></span> Loading conversation\u2026</div>';
                }
                // Mark active
                document.querySelectorAll('.mai-conv-item').forEach(el => el.classList.remove('mai-conv-active'));
                item.classList.add('mai-conv-active');
            });
        }

        // Poll for new messages when viewing a conversation detail
        initDetailPolling();
    }

    async function pollConversations() {
        try {
            const convs = await apiGet('/admin/conversations');
            const listEl = document.querySelector('.mai-conv-list');

            convs.forEach(conv => {
                const existingLink = document.querySelector(`.mai-conv-item[data-id="${conv.id}"]`);
                if (!existingLink) {
                    // New conversation — notify
                    fireAdminNotification('New conversation', conv.visitor_name || 'Anonymous');
                    location.reload();   // simple refresh to update list
                } else {
                    // Update name if it changed (e.g. extraction found visitor's name)
                    const nameEl = existingLink.querySelector('.mai-conv-name');
                    if (nameEl) {
                        const displayName = conv.visitor_name || 'Anonymous';
                        const badge = nameEl.querySelector('.mai-unread-badge');
                        const currentName = nameEl.textContent.trim();
                        if (currentName !== displayName) {
                            nameEl.textContent = displayName;
                            if (badge) nameEl.appendChild(badge);
                        }
                    }

                    // Update timestamp display
                    const tsEl = existingLink.querySelector('.mai-conv-ts');
                    if (tsEl && conv.last_message_at) {
                        const ago = timeAgo(conv.last_message_at);
                        if (tsEl.textContent.trim() !== ago) tsEl.textContent = ago;
                    }

                    if (conv.unread_admin) {
                        existingLink.classList.add('mai-conv-unread');
                        const badge = existingLink.querySelector('.mai-unread-badge');
                        if (!badge) {
                            const nameEl2 = existingLink.querySelector('.mai-conv-name');
                            if (nameEl2) {
                                const dot = document.createElement('span');
                                dot.className = 'mai-unread-badge';
                                nameEl2.appendChild(dot);
                                fireAdminNotification('New message', conv.visitor_name || 'Anonymous');
                            }
                        }
                    }
                }
                lastKnownConvs.add(conv.id);
            });

            // Re-order conversation list to match API sort order (newest first)
            if (listEl) {
                convs.forEach(conv => {
                    const el = listEl.querySelector(`.mai-conv-item[data-id="${conv.id}"]`);
                    if (el) listEl.appendChild(el);
                });
            }
        } catch(e) {
            // silent
        }
    }

    function timeAgo(dateStr) {
        const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + ' mins ago';
        if (diff < 86400) return Math.floor(diff / 3600) + ' hours ago';
        return Math.floor(diff / 86400) + ' days ago';
    }

    // -------------------------------------------------------------------------
    // Detail-view polling: auto-fetch new messages while viewing a conversation
    // -------------------------------------------------------------------------
    function initDetailPolling() {
        const thread = document.getElementById('mai-detail-messages');
        if (!thread) return;

        const convId = parseInt(thread.dataset.convId, 10);
        if (!convId) return;

        const visitorName = thread.dataset.visitorName || 'Anonymous';

        // Collect existing message IDs into the module-level set
        detailKnownIds = new Set();
        thread.querySelectorAll('.mai-admin-bubble[data-msg-id]').forEach(el => {
            detailKnownIds.add(parseInt(el.dataset.msgId, 10));
        });

        setInterval(async () => {
            try {
                const res = await apiGet(`/admin/conversations/${convId}`);
                const msgs = res.messages || [];
                let hasNew = false;

                let hasNewVisitor = false;
                msgs.forEach(msg => {
                    if (detailKnownIds.has(msg.id)) return;
                    detailKnownIds.add(msg.id);
                    hasNew = true;
                    if (msg.sender_type === 'visitor') hasNewVisitor = true;

                    const el = buildAdminBubbleEl(msg, visitorName);
                    thread.appendChild(el);
                });

                if (hasNew) {
                    thread.scrollTop = thread.scrollHeight;
                    fireAdminNotification('New message', visitorName);
                }

                // Auto-generate AI suggestion when a new visitor message arrives
                if (hasNewVisitor) {
                    autoGenerateSuggestion(convId);
                }

                // Always refresh extracted data (extraction may complete between polls)
                if (res.extracted_data) {
                    updateExtractedData(res.extracted_data);
                }

                // Update visitor name in header and sidebar if it changed
                if (res.conversation && res.conversation.visitor_name) {
                    const newName = res.conversation.visitor_name;
                    const headerName = document.querySelector('.mai-detail-visitor strong');
                    if (headerName && headerName.textContent !== newName) {
                        headerName.textContent = newName;
                        // Also update sidebar
                        const sidebarItem = document.querySelector(`.mai-conv-item[data-id="${convId}"] .mai-conv-name`);
                        if (sidebarItem) {
                            // Preserve unread badge if present
                            const badge = sidebarItem.querySelector('.mai-unread-badge');
                            sidebarItem.textContent = newName;
                            if (badge) sidebarItem.appendChild(badge);
                        }
                    }
                }
            } catch (e) {
                // silent
            }
        }, 3000);
    }

    function fireAdminNotification(title, body) {
        if (notifGranted && !document.hasFocus()) {
            const n = new Notification('Michelle AI — ' + title, { body });
            n.onclick = () => { window.focus(); n.close(); };
            setTimeout(() => n.close(), 6000);
        }
        if (sound) playNotifSound();
    }

    function playNotifSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const gain = ctx.createGain();
            gain.connect(ctx.destination);

            // Two-tone chime: C6 then E6
            const freqs = [1047, 1319];
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = freq;
                osc.connect(gain);
                const start = ctx.currentTime + i * 0.15;
                gain.gain.setValueAtTime(0.25, start);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
                osc.start(start);
                osc.stop(start + 0.3);
            });
        } catch(e) {}
    }

    // -------------------------------------------------------------------------
    // REST helpers
    // -------------------------------------------------------------------------
    async function apiGet(path) {
        const res = await fetch(API + path, {
            headers: { 'X-WP-Nonce': nonce },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Request failed');
        return json;
    }

    async function apiPost(path, body) {
        const res = await fetch(API + path, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body:    JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Request failed');
        return json;
    }

    async function apiPatch(path, body) {
        const res = await fetch(API + path, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body:    JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Request failed');
        return json;
    }

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // -------------------------------------------------------------------------
    // Extraction properties (dynamic rows)
    // -------------------------------------------------------------------------
    function collectExtractionProps() {
        const rows = document.querySelectorAll('.mai-prop-row');
        const props = [];
        rows.forEach(row => {
            const key    = row.querySelector('.mai-prop-key')?.value.trim();
            const label  = row.querySelector('.mai-prop-label')?.value.trim();
            const prompt = row.querySelector('.mai-prop-prompt')?.value.trim();
            if (key && label) {
                props.push({ key, label, prompt: prompt || '' });
            }
        });
        return props;
    }

    function initExtractionProps() {
        const container = document.getElementById('mai-extraction-props');
        const addBtn    = document.getElementById('mai-add-prop');
        if (!container || !addBtn) return;

        addBtn.addEventListener('click', () => {
            const idx = container.querySelectorAll('.mai-prop-row').length;
            const row = document.createElement('div');
            row.className = 'mai-prop-row';
            row.dataset.index = idx;
            row.innerHTML =
                '<input type="text" class="mai-prop-key" placeholder="key (e.g. city)" />' +
                '<input type="text" class="mai-prop-label" placeholder="Label (e.g. City)" />' +
                '<input type="text" class="mai-prop-prompt" placeholder="Extraction prompt..." />' +
                '<button type="button" class="button mai-prop-remove" title="Remove">&times;</button>';
            container.appendChild(row);
        });

        container.addEventListener('click', (e) => {
            if (e.target.matches('.mai-prop-remove')) {
                e.target.closest('.mai-prop-row').remove();
            }
        });
    }

    // -------------------------------------------------------------------------
    // Document templates (CRUD + placeholder insertion)
    // -------------------------------------------------------------------------
    function collectDocumentTemplates() {
        const cards = document.querySelectorAll('.mai-template-card');
        const templates = [];
        cards.forEach(card => {
            const name    = card.querySelector('.mai-tpl-name')?.value.trim();
            const content = card.querySelector('.mai-tpl-content')?.value || '';
            if (name) {
                templates.push({ name, content });
            }
        });
        return templates;
    }

    function initTemplates() {
        const list   = document.getElementById('mai-template-list');
        const addBtn = document.getElementById('mai-add-template');
        if (!list || !addBtn) return;

        // Build placeholder buttons HTML from extraction properties
        const props = collectExtractionProps();
        function placeholderBtnsHtml() {
            let html = '<span class="description">Insert:</span> ';
            props.forEach(p => {
                html += `<button type="button" class="button button-small mai-insert-placeholder" data-placeholder="{{${escHtml(p.key)}}}">${escHtml(p.label || p.key)}</button> `;
            });
            html += '<button type="button" class="button button-small mai-insert-placeholder" data-placeholder="{{date}}">Date</button>';
            return html;
        }

        addBtn.addEventListener('click', () => {
            // Remove empty state message
            list.querySelector('.mai-empty-templates')?.remove();

            const idx = list.querySelectorAll('.mai-template-card').length;
            const card = document.createElement('div');
            card.className = 'mai-template-card';
            card.dataset.index = idx;
            card.innerHTML =
                '<div class="mai-template-header">' +
                    '<input type="text" class="mai-tpl-name regular-text" placeholder="Template Name" />' +
                    '<button type="button" class="button mai-tpl-toggle">Edit</button>' +
                    '<button type="button" class="button mai-tpl-remove" style="color:#d63638;">&times;</button>' +
                '</div>' +
                '<div class="mai-template-body">' +
                    '<div class="mai-placeholder-btns">' + placeholderBtnsHtml() + '</div>' +
                    '<textarea class="mai-tpl-content large-text" rows="12" placeholder="Template content with {{placeholders}}..."></textarea>' +
                '</div>';
            list.appendChild(card);
        });

        // Toggle body visibility
        list.addEventListener('click', (e) => {
            if (e.target.matches('.mai-tpl-toggle')) {
                const body = e.target.closest('.mai-template-card').querySelector('.mai-template-body');
                if (body) {
                    body.hidden = !body.hidden;
                    e.target.textContent = body.hidden ? 'Edit' : 'Collapse';
                }
            }
            if (e.target.matches('.mai-tpl-remove')) {
                e.target.closest('.mai-template-card').remove();
            }
            // Insert placeholder at cursor position in nearest textarea
            if (e.target.matches('.mai-insert-placeholder')) {
                const card = e.target.closest('.mai-template-card');
                const ta = card?.querySelector('.mai-tpl-content');
                if (ta) {
                    const placeholder = e.target.dataset.placeholder;
                    const start = ta.selectionStart;
                    const end   = ta.selectionEnd;
                    ta.value = ta.value.substring(0, start) + placeholder + ta.value.substring(end);
                    ta.selectionStart = ta.selectionEnd = start + placeholder.length;
                    ta.focus();
                }
            }
        });

        // WordPress media uploader for letterhead
        const uploadBtn = document.getElementById('mai-upload-letterhead');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                if (!window.wp || !wp.media) {
                    alert('Media uploader not available. Please enter the URL manually.');
                    return;
                }
                const frame = wp.media({
                    title: 'Select Letterhead Logo',
                    button: { text: 'Use as Letterhead' },
                    multiple: false,
                    library: { type: 'image' },
                });
                frame.on('select', () => {
                    const url = frame.state().get('selection').first().toJSON().url;
                    document.getElementById('letterhead_url').value = url;
                });
                frame.open();
            });
        }
    }

    // -------------------------------------------------------------------------
    // Retrain system prompt from conversations
    // -------------------------------------------------------------------------
    function initRetrain() {
        const btn = document.getElementById('mai-retrain-btn');
        const modal = document.getElementById('mai-retrain-modal');
        if (!btn || !modal) return;

        const closeBtn    = document.getElementById('mai-retrain-close');
        const cancelBtn   = document.getElementById('mai-retrain-cancel');
        const generateBtn = document.getElementById('mai-retrain-generate');
        const selectAll   = document.getElementById('mai-retrain-select-all');
        const countEl     = document.getElementById('mai-retrain-selected-count');
        const listEl      = document.getElementById('mai-retrain-conv-list');
        let conversations = [];

        function openModal() {
            modal.hidden = false;
            loadConversations();
        }

        function closeModal() {
            modal.hidden = true;
        }

        btn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        async function loadConversations() {
            listEl.innerHTML = '<div class="mai-retrain-loading"><span class="mai-spinner"></span> Loading conversations\u2026</div>';
            try {
                const data = await apiGet('/admin/conversations');
                conversations = Array.isArray(data) ? data : [];
                renderConversations();
            } catch (err) {
                listEl.innerHTML = '<div class="mai-retrain-loading">Failed to load conversations.</div>';
            }
        }

        function renderConversations() {
            if (!conversations.length) {
                listEl.innerHTML = '<div class="mai-retrain-loading">No conversations available.</div>';
                return;
            }
            listEl.innerHTML = '';
            conversations.forEach(conv => {
                const name = conv.visitor_name || 'Anonymous';
                const ts = conv.last_message_at
                    ? new Date(conv.last_message_at).toLocaleDateString()
                    : '';
                const row = document.createElement('label');
                row.className = 'mai-retrain-conv-row';
                row.innerHTML =
                    `<input type="checkbox" value="${conv.id}" class="mai-retrain-cb" />` +
                    `<div class="mai-retrain-conv-info">` +
                        `<div class="mai-retrain-conv-name">${escHtml(name)}</div>` +
                        `<div class="mai-retrain-conv-meta">${escHtml(conv.visitor_email || '')} ${escHtml(ts ? '\u00B7 ' + ts : '')}</div>` +
                    `</div>` +
                    `<div class="mai-retrain-conv-msgs">${escHtml(conv.status || '')}</div>`;
                listEl.appendChild(row);
            });
            updateCount();
        }

        function getSelectedIds() {
            return Array.from(listEl.querySelectorAll('.mai-retrain-cb:checked'))
                .map(cb => parseInt(cb.value, 10));
        }

        function updateCount() {
            const ids = getSelectedIds();
            countEl.textContent = ids.length + ' selected';
            generateBtn.disabled = ids.length === 0;
        }

        listEl.addEventListener('change', (e) => {
            if (e.target.matches('.mai-retrain-cb')) {
                const row = e.target.closest('.mai-retrain-conv-row');
                if (row) row.classList.toggle('selected', e.target.checked);
                updateCount();
            }
        });

        selectAll.addEventListener('change', () => {
            const cbs = listEl.querySelectorAll('.mai-retrain-cb');
            cbs.forEach(cb => {
                cb.checked = selectAll.checked;
                const row = cb.closest('.mai-retrain-conv-row');
                if (row) row.classList.toggle('selected', selectAll.checked);
            });
            updateCount();
        });

        generateBtn.addEventListener('click', async () => {
            const ids = getSelectedIds();
            if (!ids.length) return;

            const currentPrompt = document.getElementById('system_prompt')?.value || '';
            const instructions  = document.getElementById('mai-retrain-instructions')?.value || '';

            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating\u2026';

            try {
                const res = await apiPost('/admin/retrain', {
                    conversation_ids: ids,
                    current_prompt: currentPrompt,
                    instructions: instructions,
                });

                if (res.prompt) {
                    // Show result in the modal for review before applying
                    showRetrainResult(res.prompt);
                }
            } catch (err) {
                alert('Failed to generate prompt: ' + err.message);
            }

            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate New Prompt';
        });

        function showRetrainResult(newPrompt) {
            // Remove any existing result block
            modal.querySelector('.mai-retrain-result')?.remove();

            const body = modal.querySelector('.mai-modal-body');
            const result = document.createElement('div');
            result.className = 'mai-retrain-result';
            result.innerHTML =
                '<div class="mai-retrain-result-header">' +
                    '<span>Generated Prompt (review and edit before applying)</span>' +
                '</div>' +
                '<textarea id="mai-retrain-result-text" rows="10"></textarea>';
            body.appendChild(result);
            result.querySelector('textarea').value = newPrompt;

            // Scroll the result into view
            result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Add "Apply" button to footer if not already present
            if (!document.getElementById('mai-retrain-apply')) {
                const footer = modal.querySelector('.mai-modal-footer');
                const applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'button button-primary';
                applyBtn.id = 'mai-retrain-apply';
                applyBtn.textContent = 'Apply to System Prompt';
                applyBtn.addEventListener('click', () => {
                    const resultText = document.getElementById('mai-retrain-result-text')?.value || '';
                    if (resultText) {
                        const promptField = document.getElementById('system_prompt');
                        if (promptField) {
                            promptField.value = resultText;
                        }
                    }
                    closeModal();
                });
                footer.appendChild(applyBtn);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Boot
    // -------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        initTabs();
        initTemperature();
        initSettingsForm();
        initExtractionProps();
        initTemplates();
        initRetrain();
        initMessageScroll();
        initReply();
        initSuggestedReply();
        initApprove();
        initStatusSelect();
        initDocTemplateSelect();
        initAdminPolling();
    });

})(window.jQuery || { fn: {} });
