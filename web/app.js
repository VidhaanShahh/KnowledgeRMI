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
 *
 * v2 Additions:
 * - Live dual-clock ticker (server vs client time with offset)
 * - Offset history sparkline chart
 * - Auto-sync every 30s with visual pulse animation
 * - Multi-step upload pipeline (Select → Extract → Chunk → Index → Done)
 * - File preview and metadata before upload
 * - Batch upload queue
 * - Toast notification system
 * - Lamport clock bump animation
 */

(function () {
    'use strict';

    var STATUS_POLL_INTERVAL = 5000;
    var AUTO_SYNC_INTERVAL = 30000;
    var CLOCK_TICK_INTERVAL = 1000;
    var eventLog = [];
    var currentDocuments = [];

    // Clock state
    var physicalClockOffset = 0;
    var clientLamportClock = 0;
    var serverLamportClock = 0;
    var lastSyncTimestamp = null;
    var offsetHistory = [];        // { time: Date, offset: number, wasSync: boolean }
    var MAX_OFFSET_HISTORY = 60;

    // Per-document chat histories
    var chatSessions = { "0": [] };

    // Upload queue
    var uploadQueue = [];      // { file: File, status: 'pending'|'processing'|'done'|'error', name: string }
    var isProcessingQueue = false;

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
        navDemo: document.getElementById('nav-demo'),

        viewDocuments: document.getElementById('view-documents'),
        viewAsk: document.getElementById('view-ask'),
        viewMonitor: document.getElementById('view-monitor'),
        viewDemo: document.getElementById('view-demo'),

        pageTitle: document.getElementById('page-title'),

        // Clock Ticker
        tickerStrip: document.getElementById('clock-ticker-strip'),
        tickerServerTime: document.getElementById('ticker-server-time'),
        tickerClientTime: document.getElementById('ticker-client-time'),
        tickerOffset: document.getElementById('ticker-offset'),
        tickerLamport: document.getElementById('ticker-lamport'),

        // Upload & Documents
        uploadZone: document.getElementById('upload-zone'),
        fileInput: document.getElementById('file-input'),

        // Pipeline
        uploadPipeline: document.getElementById('upload-pipeline'),
        pipelineFileIcon: document.getElementById('pipeline-file-icon'),
        pipelineFilename: document.getElementById('pipeline-filename'),
        pipelineFileSize: document.getElementById('pipeline-file-size'),
        pipelineFilePages: document.getElementById('pipeline-file-pages'),
        pipelineSteps: document.getElementById('pipeline-steps'),
        pipelineProgressFill: document.getElementById('pipeline-progress-fill'),
        pipelineStatusText: document.getElementById('pipeline-status-text'),
        filePreviewPanel: document.getElementById('file-preview-panel'),
        filePreviewContent: document.getElementById('file-preview-content'),

        // Upload Queue
        uploadQueueContainer: document.getElementById('upload-queue'),
        uploadQueueList: document.getElementById('upload-queue-list'),
        queueCount: document.getElementById('queue-count'),

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
        cardOffset: document.getElementById('card-offset'),

        // Sparkline
        sparklineSvg: document.getElementById('sparkline-svg'),

        // Toast
        toastContainer: document.getElementById('toast-container'),

        // Clock Demo
        demoServerTime: document.getElementById('demo-server-time'),
        demoClientTime: document.getElementById('demo-client-time'),
        demoOffsetNeedle: document.getElementById('demo-offset-needle'),
        demoOffsetVal: document.getElementById('demo-offset-val'),
        demoRttDisplay: document.getElementById('demo-rtt-display'),
        netPacketReq: document.getElementById('net-packet-req'),
        netPacketRes: document.getElementById('net-packet-res'),
        btnRunCristian: document.getElementById('btn-run-cristian'),
        laneClient: document.getElementById('lane-client'),
        laneServer: document.getElementById('lane-server'),
        lamportArrows: document.getElementById('lamport-arrows'),
        btnClearTimeline: document.getElementById('btn-clear-timeline')
    };


    // =========================================================
    //  NAVIGATION
    // =========================================================

    var viewMap = {
        documents: { nav: dom.navDocuments, view: dom.viewDocuments, title: 'Documents' },
        ask:       { nav: dom.navAsk,       view: dom.viewAsk,       title: 'Chat & Copilot' },
        monitor:   { nav: dom.navMonitor,   view: dom.viewMonitor,   title: 'System Monitor' },
        demo:      { nav: dom.navDemo,      view: dom.viewDemo,      title: 'Clock Sync Demo' }
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
    dom.navDemo.addEventListener('click', function () { switchView('demo'); });


    // =========================================================
    //  TOAST NOTIFICATIONS
    // =========================================================

    function showToast(type, title, message, duration) {
        duration = duration || 4000;

        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.style.setProperty('--toast-duration', duration + 'ms');
        toast.style.position = 'relative';

        var icons = { success: '✅', error: '❌', sync: '🔄', info: 'ℹ️' };

        toast.innerHTML =
            '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span>'
            + '<div class="toast-body">'
            + '<div class="toast-title">' + esc(title) + '</div>'
            + '<div class="toast-message">' + esc(message) + '</div>'
            + '</div>'
            + '<button class="toast-close">&times;</button>'
            + '<div class="toast-timer"><div class="toast-timer-fill"></div></div>';

        dom.toastContainer.appendChild(toast);

        var closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', function () { dismissToast(toast); });

        setTimeout(function () { dismissToast(toast); }, duration);
    }

    function dismissToast(toast) {
        if (toast.classList.contains('removing')) return;
        toast.classList.add('removing');
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }


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
    //  LIVE CLOCK TICKER
    // =========================================================

    function updateClockTicker() {
        var now = new Date();
        var clientTimeStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

        // Server time = client time + offset
        var serverDate = new Date(now.getTime() + physicalClockOffset);
        var serverTimeStr = pad(serverDate.getHours()) + ':' + pad(serverDate.getMinutes()) + ':' + pad(serverDate.getSeconds());

        dom.tickerClientTime.textContent = clientTimeStr;
        dom.tickerServerTime.textContent = serverTimeStr;

        // Offset display
        var absOff = Math.abs(physicalClockOffset);
        var offStr = (physicalClockOffset >= 0 ? '+' : '') + physicalClockOffset + 'ms';
        dom.tickerOffset.textContent = offStr;

        dom.tickerOffset.className = 'ticker-offset ' +
            (absOff < 50 ? 'ok' : absOff < 100 ? 'warn' : 'bad');

        // Lamport display
        dom.tickerLamport.textContent = 'L:' + clientLamportClock;
    }

    setInterval(updateClockTicker, CLOCK_TICK_INTERVAL);

    function flashSyncPulse() {
        // Pulse the sidebar status dot
        dom.sidebarStatusDot.classList.remove('pulse');
        void dom.sidebarStatusDot.offsetWidth; // reflow
        dom.sidebarStatusDot.classList.add('pulse');

        // Flash the ticker strip
        dom.tickerStrip.classList.remove('flash', 'syncing');
        void dom.tickerStrip.offsetWidth;
        dom.tickerStrip.classList.add('syncing', 'flash');

        setTimeout(function () {
            dom.tickerStrip.classList.remove('syncing');
        }, 1200);
    }

    function bumpLamportDisplay() {
        dom.tickerLamport.classList.remove('bump');
        void dom.tickerLamport.offsetWidth;
        dom.tickerLamport.classList.add('bump');
    }


    // =========================================================
    //  OFFSET HISTORY SPARKLINE
    // =========================================================

    function addOffsetSample(offset, wasSync) {
        offsetHistory.push({
            time: new Date(),
            offset: offset,
            wasSync: !!wasSync
        });
        if (offsetHistory.length > MAX_OFFSET_HISTORY) {
            offsetHistory = offsetHistory.slice(-MAX_OFFSET_HISTORY);
        }
        renderSparkline();
    }

    function renderSparkline() {
        if (!dom.sparklineSvg || offsetHistory.length < 2) return;

        var W = 800, H = 80;
        var data = offsetHistory;
        var len = data.length;

        // Calculate range
        var maxAbs = 10;
        for (var i = 0; i < len; i++) {
            var a = Math.abs(data[i].offset);
            if (a > maxAbs) maxAbs = a;
        }
        maxAbs = Math.max(maxAbs, 110) * 1.2; // ensure ±100ms threshold is visible

        var zeroY = H / 2;
        var yScale = (H / 2) / maxAbs;

        // Build path
        var points = [];
        for (var j = 0; j < len; j++) {
            var x = (j / (len - 1)) * W;
            var y = zeroY - (data[j].offset * yScale);
            y = Math.max(2, Math.min(H - 2, y));
            points.push({ x: x, y: y, d: data[j] });
        }

        // Threshold Y positions
        var threshPosY = zeroY - (100 * yScale);
        var threshNegY = zeroY + (100 * yScale);

        var pathD = 'M ' + points[0].x + ' ' + points[0].y;
        for (var k = 1; k < points.length; k++) {
            pathD += ' L ' + points[k].x + ' ' + points[k].y;
        }

        // Area path (fill under line to zero line)
        var areaD = pathD + ' L ' + points[points.length - 1].x + ' ' + zeroY + ' L ' + points[0].x + ' ' + zeroY + ' Z';

        var svg = '';

        // Threshold lines
        svg += '<line class="sparkline-threshold-pos" x1="0" y1="' + threshPosY + '" x2="' + W + '" y2="' + threshPosY + '"/>';
        svg += '<line class="sparkline-threshold-neg" x1="0" y1="' + threshNegY + '" x2="' + W + '" y2="' + threshNegY + '"/>';

        // Zero line
        svg += '<line class="sparkline-zero" x1="0" y1="' + zeroY + '" x2="' + W + '" y2="' + zeroY + '"/>';

        // Sync event markers
        for (var m = 0; m < points.length; m++) {
            if (points[m].d.wasSync) {
                svg += '<line class="sync-marker" x1="' + points[m].x + '" y1="0" x2="' + points[m].x + '" y2="' + H + '"/>';
            }
        }

        // Area
        svg += '<path class="sparkline-area" d="' + areaD + '"/>';

        // Line
        svg += '<path class="sparkline-line" d="' + pathD + '"/>';

        // Dots
        for (var n = 0; n < points.length; n++) {
            var dotColor = points[n].d.wasSync ? 'var(--accent-green)' : 'var(--accent-cyan)';
            svg += '<circle class="sparkline-dot" cx="' + points[n].x + '" cy="' + points[n].y + '" r="3" fill="' + dotColor + '">';
            svg += '<title>Offset: ' + points[n].d.offset + 'ms' + (points[n].d.wasSync ? ' (sync)' : '') + '</title>';
            svg += '</circle>';
        }

        dom.sparklineSvg.innerHTML = svg;
    }


    // =========================================================
    //  PDF TEXT EXTRACTION
    // =========================================================

    function extractTextFromPdf(file, onProgress, callback) {
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

                                    if (onProgress) {
                                        onProgress(pagesProcessed, totalPages);
                                    }

                                    if (pagesProcessed === totalPages) {
                                        callback(null, textParts.join('\n\n'), totalPages);
                                    }
                                });
                            });
                        })(i);
                    }
                })
                .catch(function (err) {
                    callback(err, null, 0);
                });
        };

        reader.readAsArrayBuffer(file);
    }


    // =========================================================
    //  MULTI-STEP UPLOAD PIPELINE
    // =========================================================

    var PIPELINE_STAGES = ['select', 'extract', 'chunk', 'index', 'done'];

    function setPipelineStep(stepName) {
        var steps = dom.pipelineSteps.querySelectorAll('.pipeline-step');
        var connectors = dom.pipelineSteps.querySelectorAll('.pipeline-connector');
        var stageIdx = PIPELINE_STAGES.indexOf(stepName);

        steps.forEach(function (s, i) {
            s.classList.remove('active', 'done', 'error');
            if (i < stageIdx) s.classList.add('done');
            else if (i === stageIdx) s.classList.add('active');
        });

        connectors.forEach(function (c, i) {
            c.classList.remove('done', 'active');
            if (i < stageIdx) c.classList.add('done');
            else if (i === stageIdx) c.classList.add('active');
        });

        // Progress fill
        var pct = (stageIdx / (PIPELINE_STAGES.length - 1)) * 100;
        dom.pipelineProgressFill.style.width = pct + '%';
    }

    function setPipelineError(stepName, msg) {
        var steps = dom.pipelineSteps.querySelectorAll('.pipeline-step');
        var stageIdx = PIPELINE_STAGES.indexOf(stepName);

        steps.forEach(function (s, i) {
            if (i === stageIdx) {
                s.classList.remove('active');
                s.classList.add('error');
            }
        });

        dom.pipelineStatusText.textContent = msg;
    }

    function showPipeline(file) {
        var ext = file.name.split('.').pop().toLowerCase();
        dom.pipelineFileIcon.textContent = ext === 'pdf' ? '📕' : '📄';
        dom.pipelineFilename.textContent = file.name;
        dom.pipelineFileSize.textContent = formatFileSize(file.size);
        dom.pipelineFilePages.textContent = ext === 'pdf' ? '— pages' : 'text file';
        dom.pipelineProgressFill.style.width = '0%';
        dom.pipelineStatusText.textContent = 'File selected...';
        dom.filePreviewPanel.classList.remove('active');
        dom.uploadPipeline.classList.add('active');

        setPipelineStep('select');
    }

    function hidePipeline() {
        setTimeout(function () {
            dom.uploadPipeline.classList.remove('active');
        }, 3000);
    }


    // =========================================================
    //  FILE UPLOAD — Enhanced with Pipeline
    // =========================================================

    function handleFiles(files) {
        if (!files || files.length === 0) return;

        // Add all to queue
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var ext = f.name.split('.').pop().toLowerCase();
            if (ext === 'pdf' || ext === 'txt') {
                uploadQueue.push({ file: f, status: 'pending', name: f.name });
            } else {
                showToast('error', 'Unsupported File', f.name + ' — only .pdf and .txt files are supported.');
            }
        }

        renderUploadQueue();

        if (!isProcessingQueue) {
            processNextInQueue();
        }
    }

    function processNextInQueue() {
        // Find next pending
        var nextItem = null;
        var nextIdx = -1;
        for (var i = 0; i < uploadQueue.length; i++) {
            if (uploadQueue[i].status === 'pending') {
                nextItem = uploadQueue[i];
                nextIdx = i;
                break;
            }
        }

        if (!nextItem) {
            isProcessingQueue = false;
            // Check if there are any items at all
            var anyItems = uploadQueue.length > 0;
            if (anyItems) {
                setTimeout(function () {
                    uploadQueue = [];
                    renderUploadQueue();
                }, 5000);
            }
            return;
        }

        isProcessingQueue = true;
        nextItem.status = 'processing';
        renderUploadQueue();
        processFile(nextItem.file, nextIdx);
    }

    function processFile(file, queueIdx) {
        var name = file.name;
        var ext = name.split('.').pop().toLowerCase();

        showPipeline(file);

        if (ext === 'pdf') {
            processPdf(file, queueIdx);
        } else if (ext === 'txt') {
            processTxt(file, queueIdx);
        }
    }

    function processPdf(file, queueIdx) {
        if (typeof pdfjsLib === 'undefined') {
            setPipelineError('extract', 'PDF.js not loaded. Try a .txt file.');
            markQueueItem(queueIdx, 'error');
            showToast('error', 'PDF.js Missing', 'Could not load PDF library.');
            processNextInQueue();
            return;
        }

        // Move to Extract step
        setPipelineStep('extract');
        dom.pipelineStatusText.textContent = 'Extracting text from PDF...';

        extractTextFromPdf(file, function (pagesProcessed, totalPages) {
            // Update pages display and progress
            dom.pipelineFilePages.textContent = pagesProcessed + '/' + totalPages + ' pages';
            var extractPct = Math.round((pagesProcessed / totalPages) * 40) + 20;
            dom.pipelineProgressFill.style.width = extractPct + '%';
            dom.pipelineStatusText.textContent = 'Extracting page ' + pagesProcessed + '/' + totalPages + '...';
        }, function (err, text, totalPages) {
            if (err) {
                setPipelineError('extract', 'Error reading PDF: ' + err.message);
                markQueueItem(queueIdx, 'error');
                showToast('error', 'Extraction Failed', file.name + ' — ' + err.message);
                processNextInQueue();
                return;
            }

            dom.pipelineFilePages.textContent = totalPages + ' pages';

            // Show preview
            showTextPreview(text);

            // Move to Chunk step
            setPipelineStep('chunk');
            dom.pipelineStatusText.textContent = 'Sending to server for chunking & indexing...';

            setTimeout(function () {
                // Move to Index step
                setPipelineStep('index');
                dom.pipelineStatusText.textContent = 'Uploading to server & building TF-IDF index...';
                uploadTextToServer(file.name, text, queueIdx);
            }, 400);
        });
    }

    function processTxt(file, queueIdx) {
        setPipelineStep('extract');
        dom.pipelineStatusText.textContent = 'Reading text file...';

        var reader = new FileReader();
        reader.onload = function () {
            var text = reader.result;
            dom.pipelineFilePages.textContent = text.length + ' chars';

            showTextPreview(text);

            setPipelineStep('chunk');
            dom.pipelineStatusText.textContent = 'Sending to server...';

            setTimeout(function () {
                setPipelineStep('index');
                dom.pipelineStatusText.textContent = 'Uploading & indexing...';
                uploadTextToServer(file.name, text, queueIdx);
            }, 300);
        };
        reader.readAsText(file);
    }

    function showTextPreview(text) {
        var preview = text.substring(0, 300).replace(/\n/g, ' ').trim();
        if (text.length > 300) preview += '...';
        dom.filePreviewContent.textContent = preview;
        dom.filePreviewPanel.classList.add('active');
    }

    function uploadTextToServer(filename, textContent, queueIdx) {

        apiPost('/api/upload',
            JSON.stringify({
                filename: filename,
                textContent: textContent
            }),
            function (err, data) {

                if (err) {
                    setPipelineError('index', 'Upload failed: ' + err.message);
                    markQueueItem(queueIdx, 'error');
                    addLogEntry('upload', 'Failed: ' + filename, clientLamportClock);
                    showToast('error', 'Upload Failed', filename + ' — ' + err.message);
                    processNextInQueue();
                    return;
                }

                // Done!
                setPipelineStep('done');
                dom.pipelineStatusText.textContent = data.message || 'Upload complete!';
                markQueueItem(queueIdx, 'done');

                addLogEntry('upload', filename + ' — ' + (data.message || 'Done'), clientLamportClock);
                addTimelineEvent('client', 'upload', clientLamportClock, 'Upload: ' + filename);
                addTimelineEvent('server', 'recv', clientLamportClock, 'Indexed: ' + filename);
                addTimelineArrow('→');
                showToast('success', 'Document Uploaded', filename + ' indexed successfully.');

                loadDocuments();
                hidePipeline();

                // Process next in queue
                setTimeout(function () { processNextInQueue(); }, 500);
            }
        );
    }


    // =========================================================
    //  UPLOAD QUEUE RENDERING
    // =========================================================

    function markQueueItem(idx, status) {
        if (idx >= 0 && idx < uploadQueue.length) {
            uploadQueue[idx].status = status;
            renderUploadQueue();
        }
    }

    function renderUploadQueue() {
        var pendingCount = 0;
        for (var i = 0; i < uploadQueue.length; i++) {
            if (uploadQueue[i].status === 'pending') pendingCount++;
        }

        if (uploadQueue.length <= 1) {
            dom.uploadQueueContainer.style.display = 'none';
            return;
        }

        dom.uploadQueueContainer.style.display = 'block';
        dom.queueCount.textContent = pendingCount;

        var html = '';
        for (var j = 0; j < uploadQueue.length; j++) {
            var item = uploadQueue[j];
            var ext = item.name.split('.').pop().toLowerCase();
            var icon = ext === 'pdf' ? '📕' : '📄';
            var statusText = item.status.charAt(0).toUpperCase() + item.status.slice(1);
            var statusDot = item.status === 'done' ? '✓ ' : item.status === 'error' ? '✕ ' : '';

            html += '<div class="queue-item">'
                + '<span class="queue-file-icon">' + icon + '</span>'
                + '<span class="queue-file-name">' + esc(item.name) + '</span>'
                + '<span class="queue-status ' + item.status + '">' + statusDot + statusText + '</span>'
                + '</div>';
        }
        dom.uploadQueueList.innerHTML = html;
    }


    // =========================================================
    //  DRAG & DROP / FILE INPUT
    // =========================================================

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
            handleFiles(e.dataTransfer.files);
        }
    });

    dom.uploadZone.addEventListener('click', function () {
        dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', function () {
        if (this.files.length > 0) {
            handleFiles(this.files);
            this.value = ''; // Reset so same file can be re-selected
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

        var currentLamport = clientLamportClock;

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
                    lamport: clientLamportClock
                });

                renderChatSession(targetDocId);

                addLogEntry('query', '"' + question + '" (' + targetDocName + ') — ' + data.length + ' results', clientLamportClock);
                addTimelineEvent('client', 'query', clientLamportClock, 'Query: "' + question + '"');
                addTimelineEvent('server', 'recv', clientLamportClock, 'RAG response: ' + data.length + ' chunks');
                addTimelineArrow('→');
                addTimelineArrow('←');
            }
        );
    }

    function renderUserBubble(text, lamportTime) {
        var bubble = document.createElement('div');
        bubble.className = 'chat-bubble user';
        bubble.innerHTML = '<div class="user-msg-content">' + esc(text) 
            + '<div style="font-size:9px; color:rgba(255,255,255,0.6); text-align:right; margin-top:4px;">'
            + 'Lamport: ' + esc(String(lamportTime || "N/A")) + '</div></div>';
        dom.chatContainer.appendChild(bubble);
    }

    function renderAssistantBubble(chunks, docName, lamportTime) {
        var bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';

        var html = '<div class="assistant-msg-header">RAG Context Response (' + esc(docName) + ') '
            + '<span style="float:right; color:var(--accent-purple); font-size:10px; background:var(--accent-purple-dim); padding:2px 6px; border-radius:4px;">'
            + 'Logical Lamport: ' + esc(String(lamportTime || "N/A")) + '</span></div>';

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

            // Update local state
            physicalClockOffset = data.physicalClockOffset || 0;
            var oldLamport = clientLamportClock;
            clientLamportClock = data.clientLamportClock || 0;
            serverLamportClock = data.serverLamportClock || 0;

            if (clientLamportClock !== oldLamport) {
                bumpLamportDisplay();
            }

            // Record offset sample (not a sync event, just a poll)
            addOffsetSample(physicalClockOffset, false);
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

    // Manual sync button
    dom.btnSync.addEventListener('click', function () {
        triggerSync(true);
    });

    function triggerSync(isManual) {
        if (isManual) {
            dom.btnSync.disabled = true;
            dom.btnSync.textContent = 'Syncing...';
        }

        apiPost('/api/sync', '', function (err, data) {
            if (isManual) {
                dom.btnSync.disabled = false;
                dom.btnSync.innerHTML =
                    '<svg width="14" height="14" viewBox="0 0 24 24"'
                    + ' fill="none" stroke="currentColor" stroke-width="2">'
                    + '<polyline points="23 4 23 10 17 10"/>'
                    + '<polyline points="1 20 1 14 7 14"/>'
                    + '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>'
                    + '<path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>'
                    + '</svg> Sync Now';
            }

            if (!err && data) {
                physicalClockOffset = data.offset || 0;
                clientLamportClock = data.lamportClock || clientLamportClock;
                lastSyncTimestamp = new Date();

                var syncMsg = 'Sync #' + data.syncCount
                    + ' — Offset: ' + (data.offset >= 0 ? '+' : '')
                    + data.offset + 'ms, RTT: ' + data.rtt + 'ms';
                    
                addLogEntry('sync', syncMsg, data.lamportClock);

                // Record sync event in sparkline
                addOffsetSample(data.offset, true);

                // Flash visuals
                flashSyncPulse();
                bumpLamportDisplay();

                // Show toast for manual sync
                if (isManual) {
                    showToast('sync', 'Clock Synchronized',
                        'Offset: ' + (data.offset >= 0 ? '+' : '') + data.offset + 'ms | RTT: ' + data.rtt + 'ms');
                }
            }

            fetchStatus();
        });
    }

    // Auto-sync every 30 seconds
    setInterval(function () {
        triggerSync(false);
    }, AUTO_SYNC_INTERVAL);


    // =========================================================
    //  EVENT LOG
    // =========================================================

    function addLogEntry(type, message, lamport) {
        var now = new Date();
        var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        eventLog.unshift({
            time: time,
            type: type,
            message: message,
            lamport: lamport !== undefined ? lamport : null
        });
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
            var isNew = i === 0 ? ' new-entry' : '';
            html += '<div class="log-entry' + isNew + '">'
                + '<span class="log-time">' + e.time + '</span>'
                + '<span class="log-type ' + e.type + '">' + e.type.toUpperCase() + '</span>';

            if (e.lamport !== null && e.lamport !== undefined) {
                html += '<span class="log-lamport">L:' + e.lamport + '</span>';
            }

            html += '<span class="log-message">' + esc(e.message) + '</span>'
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

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }


    // =========================================================
    //  CLOCK DEMO — DUAL CLOCK DISPLAY
    // =========================================================

    function updateDemoClocks() {
        var now = new Date();
        var ms = pad3(now.getMilliseconds());
        var clientStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + '.' + ms;

        var serverDate = new Date(now.getTime() + physicalClockOffset);
        var sms = pad3(serverDate.getMilliseconds());
        var serverStr = pad(serverDate.getHours()) + ':' + pad(serverDate.getMinutes()) + ':' + pad(serverDate.getSeconds()) + '.' + sms;

        if (dom.demoServerTime) dom.demoServerTime.textContent = serverStr;
        if (dom.demoClientTime) dom.demoClientTime.textContent = clientStr;

        // Offset needle position (range: -200ms to +200ms mapped to 0% to 100%)
        if (dom.demoOffsetNeedle) {
            var range = 200;
            var clamped = Math.max(-range, Math.min(range, physicalClockOffset));
            var pct = 50 + (clamped / range) * 50;
            dom.demoOffsetNeedle.style.left = pct + '%';

            var abs = Math.abs(physicalClockOffset);
            dom.demoOffsetNeedle.className = 'offset-bar-needle' +
                (abs >= 100 ? ' bad' : abs >= 50 ? ' warn' : '');
        }

        if (dom.demoOffsetVal) {
            dom.demoOffsetVal.textContent = (physicalClockOffset >= 0 ? '+' : '') + physicalClockOffset + 'ms';
            dom.demoOffsetVal.style.color = Math.abs(physicalClockOffset) < 50 ? 'var(--accent-cyan)' :
                Math.abs(physicalClockOffset) < 100 ? 'var(--accent-amber)' : 'var(--accent-red)';
        }
    }

    setInterval(updateDemoClocks, 100);

    function pad3(n) {
        if (n < 10) return '00' + n;
        if (n < 100) return '0' + n;
        return String(n);
    }


    // =========================================================
    //  CLOCK DEMO — CRISTIAN'S ALGORITHM WALKTHROUGH
    // =========================================================

    var cristianRunning = false;

    function resetCristianSteps() {
        var steps = document.querySelectorAll('.cristian-step');
        steps.forEach(function (s) { s.classList.remove('active', 'done'); });
        document.getElementById('cv-t1').textContent = 'T\u2081 = waiting...';
        document.getElementById('cv-ts').textContent = 'T_server = waiting...';
        document.getElementById('cv-t4').textContent = 'T\u2084 = waiting...';
        document.getElementById('cv-result').textContent = 'Offset = waiting...';
    }

    function runCristianDemo() {
        if (cristianRunning) return;
        cristianRunning = true;
        dom.btnRunCristian.disabled = true;
        dom.btnRunCristian.textContent = 'Running...';

        resetCristianSteps();

        // Step 1: Record T1
        setTimeout(function () {
            document.getElementById('cstep-1').classList.add('active');
            var t1 = Date.now();
            document.getElementById('cv-t1').textContent = 'T\u2081 = ' + t1 + 'ms';

            // Animate request packet
            dom.netPacketReq.classList.remove('animate-req');
            void dom.netPacketReq.offsetWidth;
            dom.netPacketReq.classList.add('animate-req');

            // Step 2: Call server (real sync)
            setTimeout(function () {
                document.getElementById('cstep-1').classList.remove('active');
                document.getElementById('cstep-1').classList.add('done');
                document.getElementById('cstep-2').classList.add('active');

                apiPost('/api/sync', '', function (err, data) {
                    var t4 = Date.now();

                    if (err) {
                        document.getElementById('cv-ts').textContent = 'Error: server unreachable';
                        resetCristianButton();
                        return;
                    }

                    var rtt = t4 - t1;
                    var serverTimeEstimate = t1 + rtt / 2;
                    var offset = data.offset || 0;

                    document.getElementById('cv-ts').textContent = 'T_server \u2248 ' + Math.round(serverTimeEstimate) + 'ms';

                    // Animate response packet
                    dom.netPacketRes.classList.remove('animate-res');
                    void dom.netPacketRes.offsetWidth;
                    dom.netPacketRes.classList.add('animate-res');

                    // Step 3: Record T4
                    setTimeout(function () {
                        document.getElementById('cstep-2').classList.remove('active');
                        document.getElementById('cstep-2').classList.add('done');
                        document.getElementById('cstep-3').classList.add('active');
                        document.getElementById('cv-t4').textContent = 'T\u2084 = ' + t4 + 'ms';

                        if (dom.demoRttDisplay) {
                            dom.demoRttDisplay.textContent = 'RTT: ' + rtt + 'ms';
                        }

                        // Step 4: Calculate
                        setTimeout(function () {
                            document.getElementById('cstep-3').classList.remove('active');
                            document.getElementById('cstep-3').classList.add('done');
                            document.getElementById('cstep-4').classList.add('active');

                            document.getElementById('cv-result').textContent =
                                'RTT = ' + rtt + 'ms \u00B7 Offset = ' + (offset >= 0 ? '+' : '') + offset + 'ms';

                            // Update state
                            physicalClockOffset = offset;
                            clientLamportClock = data.lamportClock || clientLamportClock;

                            // Add timeline events
                            addTimelineEvent('client', 'sync', clientLamportClock, 'Sync request (Cristian\'s)');
                            addTimelineEvent('server', 'recv', data.lamportClock || 0, 'Clock response (offset: ' + offset + 'ms)');
                            addTimelineArrow('\u2192');
                            addTimelineArrow('\u2190');

                            flashSyncPulse();
                            bumpLamportDisplay();
                            addOffsetSample(offset, true);

                            addLogEntry('sync', 'Cristian demo — RTT: ' + rtt + 'ms, Offset: ' + offset + 'ms', clientLamportClock);

                            setTimeout(function () {
                                document.getElementById('cstep-4').classList.remove('active');
                                document.getElementById('cstep-4').classList.add('done');
                                resetCristianButton();
                            }, 800);

                        }, 600);
                    }, 500);
                });
            }, 600);
        }, 300);
    }

    function resetCristianButton() {
        cristianRunning = false;
        dom.btnRunCristian.disabled = false;
        dom.btnRunCristian.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
            + '<polygon points="5 3 19 12 5 21 5 3"/>'
            + '</svg> Run Demonstration';
    }

    if (dom.btnRunCristian) {
        dom.btnRunCristian.addEventListener('click', runCristianDemo);
    }


    // =========================================================
    //  CLOCK DEMO — LAMPORT TIMELINE
    // =========================================================

    var timelineEvents = []; // { side: 'client'|'server', type, lamport, desc, time }

    function addTimelineEvent(side, type, lamport, desc) {
        var now = new Date();
        var timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

        timelineEvents.push({
            side: side,
            type: type,
            lamport: lamport,
            desc: desc,
            time: timeStr
        });

        if (timelineEvents.length > 30) {
            timelineEvents = timelineEvents.slice(-30);
        }

        renderTimeline();
    }

    function addTimelineArrow(symbol) {
        if (!dom.lamportArrows) return;
        var arrow = document.createElement('div');
        arrow.className = 'lamport-arrow';
        arrow.textContent = symbol;
        dom.lamportArrows.appendChild(arrow);

        // Keep only last 15 arrows
        while (dom.lamportArrows.children.length > 15) {
            dom.lamportArrows.removeChild(dom.lamportArrows.firstChild);
        }
    }

    function renderTimeline() {
        if (!dom.laneClient || !dom.laneServer) return;

        var clientHtml = '';
        var serverHtml = '';

        for (var i = 0; i < timelineEvents.length; i++) {
            var ev = timelineEvents[i];
            var eventHtml = '<div class="lane-event ' + ev.type + '">'
                + '<span class="event-lamport">L:' + ev.lamport + '</span>'
                + '<span class="event-desc">' + esc(ev.desc) + '</span>'
                + '<span class="event-time">' + ev.time + '</span>'
                + '</div>';

            if (ev.side === 'client') {
                clientHtml += eventHtml;
            } else {
                serverHtml += eventHtml;
            }
        }

        dom.laneClient.innerHTML = clientHtml || '<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:20px;">No client events yet</div>';
        dom.laneServer.innerHTML = serverHtml || '<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:20px;">No server events yet</div>';
    }

    if (dom.btnClearTimeline) {
        dom.btnClearTimeline.addEventListener('click', function () {
            timelineEvents = [];
            if (dom.lamportArrows) dom.lamportArrows.innerHTML = '';
            renderTimeline();
        });
    }


    // =========================================================
    //  HOOK: Add timeline events on existing operations
    // =========================================================

    // Override triggerSync to also add timeline events
    var _origTriggerSync = triggerSync;
    triggerSync = function (isManual) {
        // Add client-side event before sync
        addTimelineEvent('client', 'sync', clientLamportClock, isManual ? 'Manual sync request' : 'Auto-sync (30s)');
        addTimelineArrow('\u2192');
        _origTriggerSync(isManual);
    };


    // =========================================================
    //  INIT
    // =========================================================

    loadDocuments();
    fetchStatus();
    addLogEntry('clock', 'Dashboard connected. Live clock ticker active.', 0);
    renderLog();
    updateClockTicker();
    updateDemoClocks();
    renderTimeline();

    setInterval(fetchStatus, STATUS_POLL_INTERVAL);

    // Initial sync
    triggerSync(false);

})();
