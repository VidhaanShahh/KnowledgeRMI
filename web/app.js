/**
 * Knowledge Base RAG Dashboard — Frontend Logic
 *
 * Features:
 * - PDF text extraction via PDF.js (browser-side)
 * - Per-document dedicated chat sessions (chats change per document context)
 * - Hybrid TF-IDF + Keyword Fallback RAG retrieval
 * - Document upload to /api/upload
 * - RAG query via /api/query?q=...&docId=...
 * - System Monitor with live clock sync polling
 */

(function () {
    'use strict';

    var STATUS_POLL_INTERVAL = 5000;
    var eventLog = [];
    var currentDocuments = [];

    // Per-document chat histories: key is docId ("0" for global, "1", "2", etc.)
    // Each entry: { role: 'user'|'assistant', text: string, chunks: [...], docName: string }
    var chatSessions = { "0": [] };

    // Configure PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // =========================================================
    //  DOM
    // =========================================================

    var dom = {
        navDocuments: document.getElementById('nav-documents'),
        navAsk: document.getElementById('nav-ask'),
        navMonitor: document.getElementById('nav-monitor'),

        viewDocuments: document.getElementById('view-documents'),
        viewAsk: document.getElementById('view-ask'),
        viewMonitor: document.getElementById('view-monitor'),

        pageTitle: document.getElementById('page-title'),
        topLamport: document.getElementById('top-lamport'),

        // Upload & Documents
        uploadZone: document.getElementById('upload-zone'),
        fileInput: document.getElementById('file-input'),
        uploadProgress: document.getElementById('upload-progress'),
        progressFill: document.getElementById('progress-fill'),
        progressText: document.getElementById('progress-text'),
        documentsTbody: document.getElementById('documents-tbody'),

        // Ask / Chat
        docSelectDropdown: document.getElementById('doc-select-dropdown'),
        chatContainer: document.getElementById('chat-messages-container'),
        queryInput: document.getElementById('query-input'),
        btnAsk: document.getElementById('btn-ask'),

        // Monitor
        btnSync: document.getElementById('btn-sync'),
        syncStatusText: document.getElementById('sync-status-text'),
        btnClearLog: document.getElementById('btn-clear-log'),
        eventLogBody: document.getElementById('event-log-body'),

        metricStatus: document.getElementById('metric-status'),
        metricStatusSub: document.getElementById('metric-status-sub'),
        metricOffset: document.getElementById('metric-offset'),
        metricRtt: document.getElementById('metric-rtt'),
        metricLamportClient: document.getElementById('metric-lamport-client'),
        metricLamportServer: document.getElementById('metric-lamport-server'),
        metricSyncs: document.getElementById('metric-syncs'),
        metricUptimeSub: document.getElementById('metric-uptime-sub'),

        sidebarStatusDot: document.getElementById('sidebar-status-dot'),
        sidebarStatusText: document.getElementById('sidebar-status-text'),

        cardStatus: document.getElementById('card-status'),
        cardOffset: document.getElementById('card-offset')
    };


    // =========================================================
    //  NAVIGATION
    // =========================================================

    var viewMap = {
        documents: { nav: dom.navDocuments, view: dom.viewDocuments, title: 'Documents' },
        ask:       { nav: dom.navAsk,       view: dom.viewAsk,       title: 'Chat & Copilot' },
        monitor:   { nav: dom.navMonitor,   view: dom.viewMonitor,   title: 'System Monitor' }
    };

    function switchView(name) {
        for (var key in viewMap) {
            var v = viewMap[key];
            v.nav.classList.toggle('active', key === name);
            v.view.classList.toggle('active', key === name);
        }
        dom.pageTitle.textContent = viewMap[name].title;
    }

    dom.navDocuments.addEventListener('click', function () { switchView('documents'); });
    dom.navAsk.addEventListener('click', function () { switchView('ask'); });
    dom.navMonitor.addEventListener('click', function () { switchView('monitor'); });


    // =========================================================
    //  API HELPERS
    // =========================================================

    function apiGet(path, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', path, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try { cb(null, JSON.parse(xhr.responseText)); }
                    catch (e) { cb(e, null); }
                } else { cb(new Error('HTTP ' + xhr.status), null); }
            }
        };
        xhr.send();
    }

    function apiPost(path, body, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', path, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try { cb(null, JSON.parse(xhr.responseText)); }
                    catch (e) { cb(e, null); }
                } else { cb(new Error('HTTP ' + xhr.status), null); }
            }
        };
        xhr.send(typeof body === 'string' ? body : JSON.stringify(body));
    }


    // =========================================================
    //  PDF TEXT EXTRACTION
    // =========================================================

    function extractTextFromPdf(file, callback) {
        var reader = new FileReader();

        reader.onload = function () {
            var typedArray = new Uint8Array(reader.result);

            pdfjsLib.getDocument(typedArray).promise
                .then(function (pdf) {
                    var totalPages = pdf.numPages;
                    var textParts = [];
                    var pagesProcessed = 0;

                    for (var i = 1; i <= totalPages; i++) {
                        (function (pageNum) {
                            pdf.getPage(pageNum).then(function (page) {
                                page.getTextContent().then(function (content) {

                                    var pageText = content.items.map(function (item) {
                                        return item.str;
                                    }).join(' ');

                                    textParts[pageNum - 1] = pageText;
                                    pagesProcessed++;

                                    var pct = Math.round((pagesProcessed / totalPages) * 60);
                                    dom.progressFill.style.width = pct + '%';
                                    dom.progressText.textContent = 'Extracting page ' + pagesProcessed + '/' + totalPages + '...';

                                    if (pagesProcessed === totalPages) {
                                        callback(null, textParts.join('\n\n'));
                                    }
                                });
                            });
                        })(i);
                    }
                })
                .catch(function (err) {
                    callback(err, null);
                });
        };

        reader.readAsArrayBuffer(file);
    }


    // =========================================================
    //  FILE UPLOAD
    // =========================================================

    function handleFile(file) {

        if (!file) return;

        var name = file.name;
        var ext = name.split('.').pop().toLowerCase();

        dom.uploadProgress.style.display = 'flex';
        dom.progressFill.style.width = '10%';
        dom.progressText.textContent = 'Reading file...';

        if (ext === 'pdf') {

            if (typeof pdfjsLib === 'undefined') {
                dom.progressText.textContent = 'PDF.js not loaded. Try a .txt file.';
                return;
            }

            extractTextFromPdf(file, function (err, text) {
                if (err) {
                    dom.progressText.textContent = 'Error reading PDF: ' + err.message;
                    return;
                }
                uploadText(name, text);
            });

        } else if (ext === 'txt') {

            var reader = new FileReader();
            reader.onload = function () {
                dom.progressFill.style.width = '60%';
                uploadText(name, reader.result);
            };
            reader.readAsText(file);

        } else {
            dom.progressText.textContent = 'Unsupported format. Use .pdf or .txt';
        }
    }

    function uploadText(filename, textContent) {

        dom.progressFill.style.width = '70%';
        dom.progressText.textContent = 'Uploading to server...';

        apiPost('/api/upload',
            JSON.stringify({
                filename: filename,
                textContent: textContent
            }),
            function (err, data) {

                if (err) {
                    dom.progressFill.style.width = '100%';
                    dom.progressText.textContent = 'Upload failed: ' + err.message;
                    addLogEntry('upload', 'Failed: ' + filename);
                    return;
                }

                dom.progressFill.style.width = '100%';
                dom.progressText.textContent = data.message || 'Upload complete';

                addLogEntry('upload', filename + ' — ' + (data.message || 'Done'));

                loadDocuments();

                setTimeout(function () {
                    dom.uploadProgress.style.display = 'none';
                    dom.progressFill.style.width = '0%';
                }, 3000);
            }
        );
    }

    dom.uploadZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        this.classList.add('dragover');
    });

    dom.uploadZone.addEventListener('dragleave', function () {
        this.classList.remove('dragover');
    });

    dom.uploadZone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    dom.uploadZone.addEventListener('click', function () {
        dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', function () {
        if (this.files.length > 0) {
            handleFile(this.files[0]);
        }
    });


    // =========================================================
    //  DOCUMENTS LIST & DROPDOWN POPULATION
    // =========================================================

    function loadDocuments() {

        apiGet('/api/documents', function (err, data) {

            if (err) {
                dom.documentsTbody.innerHTML =
                    '<tr><td colspan="5" class="loading">'
                    + 'Unable to connect. Ensure servers are running.'
                    + '</td></tr>';
                return;
            }

            currentDocuments = data || [];
            updateDocDropdown();

            if (!data || data.length === 0) {
                dom.documentsTbody.innerHTML =
                    '<tr><td colspan="5">'
                    + '<div class="empty-state">'
                    + '<div class="empty-icon">&#128196;</div>'
                    + '<p>No documents uploaded yet.</p>'
                    + '</div></td></tr>';
                return;
            }

            var html = '';
            for (var i = 0; i < data.length; i++) {
                var d = data[i];
                html += '<tr>'
                    + '<td>' + esc(d.id) + '</td>'
                    + '<td>' + esc(d.filename) + '</td>'
                    + '<td>' + esc(d.uploaded) + '</td>'
                    + '<td>' + esc(d.chunks) + '</td>'
                    + '<td><button class="btn-chat-doc" data-id="' + esc(d.id) + '" data-name="' + esc(d.filename) + '">Chat with PDF</button></td>'
                    + '</tr>';
            }
            dom.documentsTbody.innerHTML = html;

            var chatBtns = dom.documentsTbody.querySelectorAll('.btn-chat-doc');
            for (var j = 0; j < chatBtns.length; j++) {
                chatBtns[j].addEventListener('click', function (e) {
                    e.stopPropagation();
                    var docId = this.getAttribute('data-id');
                    dom.docSelectDropdown.value = docId;
                    renderChatSession(docId);
                    switchView('ask');
                });
            }
        });
    }

    function updateDocDropdown() {
        var selectedVal = dom.docSelectDropdown.value;
        var html = '<option value="0">All Documents (Global Search)</option>';

        for (var i = 0; i < currentDocuments.length; i++) {
            var d = currentDocuments[i];
            html += '<option value="' + esc(d.id) + '">📄 ' + esc(d.filename) + '</option>';
        }

        dom.docSelectDropdown.innerHTML = html;
        if (selectedVal) {
            dom.docSelectDropdown.value = selectedVal;
        }
    }


    // =========================================================
    //  PER-DOCUMENT CHAT HISTORY & RENDERING
    // =========================================================

    dom.docSelectDropdown.addEventListener('change', function () {
        var docId = this.value;
        renderChatSession(docId);
    });

    function renderChatSession(docId) {
        docId = String(docId || "0");
        if (!chatSessions[docId]) {
            chatSessions[docId] = [];
        }

        var history = chatSessions[docId];
        dom.chatContainer.innerHTML = '';

        if (history.length === 0) {
            var docName = 'All Documents';
            if (docId !== "0") {
                for (var i = 0; i < currentDocuments.length; i++) {
                    if (String(currentDocuments[i].id) === docId) {
                        docName = currentDocuments[i].filename;
                        break;
                    }
                }
            }

            var empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<div class="empty-icon">&#128172;</div>'
                + '<p>Dedicated chat context for <strong>' + esc(docName) + '</strong>.<br>'
                + 'Ask any question to retrieve relevant information from this document.</p>';
            dom.chatContainer.appendChild(empty);
            return;
        }

        for (var k = 0; k < history.length; k++) {
            var item = history[k];
            if (item.role === 'user') {
                renderUserBubble(item.text, item.lamport);
            } else if (item.role === 'assistant') {
                renderAssistantBubble(item.chunks, item.docName, item.lamport);
            } else if (item.role === 'error') {
                renderErrorBubble(item.text);
            }
        }
        scrollToBottom();
    }


    function performQuery() {

        var question = dom.queryInput.value.trim();
        if (!question) return;

        var targetDocId = dom.docSelectDropdown.value || "0";
        var targetDocName = 'All Documents';

        if (targetDocId !== "0") {
            for (var i = 0; i < currentDocuments.length; i++) {
                if (String(currentDocuments[i].id) === targetDocId) {
                    targetDocName = currentDocuments[i].filename;
                    break;
                }
            }
        }

        if (!chatSessions[targetDocId]) {
            chatSessions[targetDocId] = [];
        }

        var currentLamport = dom.metricLamportClient.textContent || "N/A";

        // Add user message to session
        chatSessions[targetDocId].push({ role: 'user', text: question, lamport: currentLamport });
        renderChatSession(targetDocId);

        dom.queryInput.value = '';
        dom.btnAsk.disabled = true;
        dom.btnAsk.textContent = 'Searching...';

        apiGet('/api/query?q=' + encodeURIComponent(question) + '&docId=' + targetDocId,
            function (err, data) {

                dom.btnAsk.disabled = false;
                dom.btnAsk.innerHTML =
                    '<svg width="16" height="16" viewBox="0 0 24 24"'
                    + ' fill="none" stroke="currentColor" stroke-width="2">'
                    + '<line x1="22" y1="2" x2="11" y2="13"/>'
                    + '<polygon points="22 2 15 22 11 13 2 9 22 2"/>'
                    + '</svg> Send';

                if (err) {
                    var errMsg = 'Query failed. Check server connection.';
                    chatSessions[targetDocId].push({ role: 'error', text: errMsg });
                    renderChatSession(targetDocId);
                    return;
                }

                if (!data || data.length === 0 || (data.length === 1 && data[0].content && data[0].content.indexOf('No relevant') >= 0)) {
                    var noResMsg = 'No relevant content found matching your query in ' + targetDocName + '.';
                    chatSessions[targetDocId].push({ role: 'error', text: noResMsg });
                    renderChatSession(targetDocId);
                    return;
                }

        // Add assistant response to session
                chatSessions[targetDocId].push({
                    role: 'assistant',
                    chunks: data,
                    docName: targetDocName,
                    lamport: dom.metricLamportClient.textContent || "N/A"
                });

                renderChatSession(targetDocId);

                addLogEntry('query', '"' + question + '" (' + targetDocName + ') — ' + data.length + ' results');
            }
        );
    }

    function renderUserBubble(text, lamportTime) {
        var bubble = document.createElement('div');
        bubble.className = 'chat-bubble user';
        bubble.innerHTML = '<div class="user-msg-content">' + esc(text) 
            + '<div style="font-size:9px; color:rgba(255,255,255,0.6); text-align:right; margin-top:4px;">'
            + 'Lamport: ' + esc(lamportTime || "N/A") + '</div></div>';
        dom.chatContainer.appendChild(bubble);
    }

    function renderAssistantBubble(chunks, docName, lamportTime) {
        var bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';

        var html = '<div class="assistant-msg-header">RAG Context Response (' + esc(docName) + ') '
            + '<span style="float:right; color:var(--accent-purple); font-size:10px; background:var(--accent-purple-dim); padding:2px 6px; border-radius:4px;">'
            + 'Logical Lamport: ' + esc(lamportTime || "N/A") + '</span></div>';

        for (var i = 0; i < chunks.length; i++) {
            var r = chunks[i];
            var score = parseFloat(r.score) || 0;
            var barWidth = Math.min(score, 100);

            html += '<div class="chunk-card">'
                + '<div class="chunk-card-header">'
                + '<span class="chunk-source">' + esc(r.source) + '</span>'
                + '<span class="chunk-score">'
                + '<span class="score-bar"><span class="score-bar-fill" style="width:' + barWidth + '%"></span></span>'
                + score.toFixed(1) + '%'
                + '</span></div>'
                + '<div class="chunk-label">Retrieved Chunk</div>'
                + '<div class="chunk-content">' + esc(r.content) + '</div>'
                + '</div>';
        }

        bubble.innerHTML = html;
        dom.chatContainer.appendChild(bubble);
    }

    function renderErrorBubble(msg) {
        var bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';
        bubble.innerHTML = '<div class="assistant-msg-header">System</div>'
            + '<div class="chunk-card"><div class="chunk-content" style="color:var(--accent-amber);">' + esc(msg) + '</div></div>';
        dom.chatContainer.appendChild(bubble);
    }

    function scrollToBottom() {
        dom.chatContainer.scrollTop = dom.chatContainer.scrollHeight;
    }

    dom.btnAsk.addEventListener('click', performQuery);
    dom.queryInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') performQuery();
    });


    // =========================================================
    //  SYSTEM MONITOR
    // =========================================================

    function fetchStatus() {
        apiGet('/api/status', function (err, data) {
            if (err) {
                updateSidebar('error', 'Disconnected');
                return;
            }
            updateMetrics(data);
            updateSidebar(
                data.status === 'SYNCHRONIZED' ? 'good' : 'warning',
                data.status === 'SYNCHRONIZED' ? 'Synchronized' : 'Drift detected'
            );
        });
    }

    function updateMetrics(d) {
        var synced = d.status === 'SYNCHRONIZED';
        dom.metricStatus.textContent = synced ? 'Synced' : 'Drift';
        dom.metricStatusSub.textContent = synced ? 'Clocks within tolerance' : 'Offset exceeds 100ms';
        dom.cardStatus.className = 'metric-card ' + (synced ? 'status-good' : 'status-warn');

        var off = d.physicalClockOffset;
        dom.metricOffset.textContent = (off >= 0 ? '+' : '') + off + 'ms';
        dom.cardOffset.className = 'metric-card ' + (Math.abs(off) < 100 ? 'status-good' : 'status-warn');

        dom.metricRtt.textContent = d.roundTripTime + 'ms';
        dom.metricLamportClient.textContent = d.clientLamportClock;
        dom.metricLamportServer.textContent = d.serverLamportClock;
        dom.topLamport.textContent = 'Lamport: C=' + d.clientLamportClock + ' S=' + d.serverLamportClock;
        dom.metricSyncs.textContent = d.syncCount;
        dom.metricUptimeSub.textContent = 'Uptime: ' + d.serverUptime;
        dom.syncStatusText.textContent = 'Last sync: ' + d.lastSyncTime;
    }

    function updateSidebar(level, text) {
        dom.sidebarStatusDot.className = 'status-dot'
            + (level === 'warning' ? ' warning' : '')
            + (level === 'error' ? ' error' : '');
        dom.sidebarStatusText.textContent = text;
    }

    dom.btnSync.addEventListener('click', function () {
        dom.btnSync.disabled = true;
        dom.btnSync.textContent = 'Syncing...';

        apiPost('/api/sync', '', function (err, data) {
            dom.btnSync.disabled = false;
            dom.btnSync.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24"'
                + ' fill="none" stroke="currentColor" stroke-width="2">'
                + '<polyline points="23 4 23 10 17 10"/>'
                + '<polyline points="1 20 1 14 7 14"/>'
                + '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>'
                + '<path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>'
                + '</svg> Sync Now';

            if (!err && data) {
                var syncMsg = 'Sync #' + data.syncCount
                    + ' — Offset: ' + (data.offset >= 0 ? '+' : '')
                    + data.offset + 'ms, RTT: ' + data.rtt + 'ms';
                    
                addLogEntry('sync', syncMsg);
                
                // Also add a visible event to the current chat session if in Ask view
                var targetDocId = dom.docSelectDropdown.value || "0";
                if (!chatSessions[targetDocId]) {
                    chatSessions[targetDocId] = [];
                }
                chatSessions[targetDocId].push({ role: 'error', text: 'System Clock Synchronized (Cristian\'s Algorithm). Offset: ' + data.offset + 'ms' });
                if (dom.viewAsk.classList.contains('active')) {
                    renderChatSession(targetDocId);
                }
            }
            fetchStatus();
        });
    });


    // =========================================================
    //  EVENT LOG
    // =========================================================

    function addLogEntry(type, message) {
        var now = new Date();
        var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        eventLog.unshift({ time: time, type: type, message: message });
        if (eventLog.length > 50) eventLog = eventLog.slice(0, 50);
        renderLog();
    }

    function renderLog() {
        if (eventLog.length === 0) {
            dom.eventLogBody.innerHTML =
                '<div class="log-entry"><span class="log-message" style="color:var(--text-muted)">'
                + 'No events yet.</span></div>';
            return;
        }
        var html = '';
        for (var i = 0; i < eventLog.length; i++) {
            var e = eventLog[i];
            html += '<div class="log-entry">'
                + '<span class="log-time">' + e.time + '</span>'
                + '<span class="log-type ' + e.type + '">' + e.type.toUpperCase() + '</span>'
                + '<span class="log-message">' + esc(e.message) + '</span>'
                + '</div>';
        }
        dom.eventLogBody.innerHTML = html;
    }

    dom.btnClearLog.addEventListener('click', function () {
        eventLog = [];
        renderLog();
    });


    // =========================================================
    //  UTILITIES
    // =========================================================

    function esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }


    // =========================================================
    //  INIT
    // =========================================================

    loadDocuments();
    fetchStatus();
    addLogEntry('sync', 'Dashboard connected.');
    renderLog();

    setInterval(fetchStatus, STATUS_POLL_INTERVAL);

})();
