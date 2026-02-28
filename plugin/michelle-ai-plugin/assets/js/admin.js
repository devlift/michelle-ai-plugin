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
            ['chat_enabled','auto_reply','moderation_mode','notification_sound'].forEach(k => {
                if (!(k in data)) data[k] = false;
                else data[k] = true;
            });
            // Numeric fields
            if (data.context_messages) data.context_messages = parseInt(data.context_messages, 10);
            if (data.temperature)      data.temperature      = parseFloat(data.temperature);

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
            await apiPost(`/admin/conversations/${convId}/messages`, { content: text });
            appendAdminBubble(text);
        } catch(err) {
            alert('Failed to send: ' + err.message);
        }
    }

    function appendAdminBubble(text) {
        const thread = document.getElementById('mai-detail-messages');
        if (!thread) return;
        const el = document.createElement('div');
        el.className = 'mai-admin-bubble mai-bubble-admin';
        el.innerHTML = `<div class="mai-bubble-sender">Admin <span class="mai-bubble-time">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div><div class="mai-bubble-text">${escHtml(text)}</div>`;
        thread.appendChild(el);
        thread.scrollTop = thread.scrollHeight;
    }

    // -------------------------------------------------------------------------
    // AI Suggested reply
    // -------------------------------------------------------------------------
    function initSuggestedReply() {
        const regenBtn = document.getElementById('mai-regenerate-btn');
        const useBtn   = document.getElementById('mai-use-suggestion-btn');
        const textarea = document.getElementById('mai-suggestion-text');
        if (!regenBtn || !useBtn || !textarea) return;

        const convId = parseInt(regenBtn.dataset.convId, 10);

        regenBtn.addEventListener('click', async () => {
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
    // Admin polling (new conversations / messages)
    // -------------------------------------------------------------------------
    let lastKnownConvs   = new Set();
    let adminPollTimer   = null;
    let notifGranted     = false;

    function initAdminPolling() {
        // Only poll on the conversations page
        if (!document.querySelector('.mai-conv-list')) return;

        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                notifGranted = true;
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(p => { notifGranted = p === 'granted'; });
            }
        }

        // Seed known conversations
        document.querySelectorAll('.mai-conv-item').forEach(el => {
            lastKnownConvs.add(parseInt(el.dataset.id, 10));
        });

        adminPollTimer = setInterval(pollConversations, 3000);
    }

    async function pollConversations() {
        try {
            const convs = await apiGet('/admin/conversations');
            convs.forEach(conv => {
                const existingLink = document.querySelector(`.mai-conv-item[data-id="${conv.id}"]`);
                if (!existingLink) {
                    // New conversation — notify
                    fireAdminNotification('New conversation', conv.visitor_name || 'Anonymous');
                    location.reload();   // simple refresh to update list
                } else if (conv.unread_admin) {
                    existingLink.classList.add('mai-conv-unread');
                    const badge = existingLink.querySelector('.mai-unread-badge');
                    if (!badge) {
                        const nameEl = existingLink.querySelector('.mai-conv-name');
                        if (nameEl) {
                            const dot = document.createElement('span');
                            dot.className = 'mai-unread-badge';
                            nameEl.appendChild(dot);
                            // Notify
                            fireAdminNotification('New message', conv.visitor_name || 'Anonymous');
                        }
                    }
                }
                lastKnownConvs.add(conv.id);
            });
        } catch(e) {
            // silent
        }
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
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.4);
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
    // Boot
    // -------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        initTabs();
        initTemperature();
        initSettingsForm();
        initReply();
        initSuggestedReply();
        initApprove();
        initStatusSelect();
        initAdminPolling();
    });

})(window.jQuery || { fn: {} });
