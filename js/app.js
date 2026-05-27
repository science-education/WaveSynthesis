/**
 * WaveSynthesis - App Controller & Visualization
 * Coordinates UI inputs, FFT analysis, dynamic synthesis, and HTML5 Canvas drawing.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Instanciate our Web Audio helper
    const audio = new WaveAudio();

    // UI elements
    const btnRecord = document.getElementById('btn-record');
    const recordCountdown = document.getElementById('record-countdown');
    const recordingStatus = document.getElementById('recording-status');
    const presetSelect = document.getElementById('preset-select');
    const btnPlaySynth = document.getElementById('btn-play-synth');
    const volumeSlider = document.getElementById('volume-slider');
    const componentsList = document.getElementById('components-list');
    const btnSelectAll = document.getElementById('btn-select-all');
    const btnClearAll = document.getElementById('btn-clear-all');

    // Tab elements
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Canvas elements & context configurations
    const canvasMain = document.getElementById('canvas-main-waveform');
    const canvasSpectrum = document.getElementById('canvas-spectrum');
    let ctxMain = null;
    let ctxSpectrum = null;

    // Active analysis state
    let activeIndices = new Set();      // Which FFT bins are checked to add up
    let displayComponents = [];         // Top 12 frequency components shown in UI
    let activeSolo = null;              // Tracks currently playing solo tone timeout/handle

    // Resizing and configuring canvas with Device Pixel Ratio for crystal clear curves
    function resizeCanvases() {
        const dpr = window.devicePixelRatio || 1;

        if (canvasMain) {
            const rect = canvasMain.parentNode.getBoundingClientRect();
            canvasMain.width = rect.width * dpr;
            canvasMain.height = rect.height * dpr;
            ctxMain = canvasMain.getContext('2d');
            ctxMain.scale(dpr, dpr);
        }

        if (canvasSpectrum) {
            const rect = canvasSpectrum.parentNode.getBoundingClientRect();
            canvasSpectrum.width = rect.width * dpr;
            canvasSpectrum.height = rect.height * dpr;
            ctxSpectrum = canvasSpectrum.getContext('2d');
            ctxSpectrum.scale(dpr, dpr);
        }

        // Redraw immediately if we have loaded data
        drawGraphs();
    }

    // Set up Resize Observer to dynamically adapt to layout shifts
    const resizeObserver = new ResizeObserver(() => resizeCanvases());
    if (canvasMain && canvasMain.parentNode) {
        resizeObserver.observe(canvasMain.parentNode);
    }
    window.addEventListener('resize', resizeCanvases);

    // Initial setup
    resizeCanvases();

    /* ==========================================================================
       TAB CONTROLLERS
       ========================================================================== */
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));

            btn.classList.add('active');
            const targetTab = document.getElementById(`${btn.dataset.tab}-tab`);
            if (targetTab) {
                targetTab.classList.remove('hidden');
            }
            
            // Re-render graphs for active tab
            drawGraphs();
        });
    });

    /* ==========================================================================
       AUDIO & FFT PROCESSORS
       ========================================================================== */

    function processNewAudioSource() {
        // Run raw FFT analysis to populate real/imag parts
        audio.analyzeSource();

        // Perform clean amplitude analysis for UI listing
        const allComponents = WaveFFT.analyze(audio.sourceBuffer, audio.sampleRate);

        // Sort by amplitude (strength) to find the top 12 primary harmonics
        // This filters out high frequency fuzz/noise and keeps the most distinct parts.
        const sorted = [...allComponents].sort((a, b) => b.amp - a.amp);
        
        // Take the top 12 strongest components
        displayComponents = sorted.slice(0, 12);
        
        // Sort them back ascending by frequency index (lowest frequency to highest)
        // This is crucial for education so users see the foundational wave on top, and high harmonics below.
        displayComponents.sort((a, b) => a.index - b.index);

        // Reset check state to check ALL of these top 12 by default
        activeIndices.clear();
        displayComponents.forEach(comp => activeIndices.add(comp.index));

        // Re-enable playback controls
        btnPlaySynth.disabled = false;

        // Build list and draw UI
        renderComponentsList();
        drawGraphs();

        // If currently playing, update running PeriodicWave coefficients immediately
        if (audio.isPlaying) {
            audio.updateActiveHarmonics(activeIndices);
        }
    }

    /* ==========================================================================
       CANVAS RENDERING LOGIC (Graphs and Plots)
       ========================================================================== */

    function drawGraphs() {
        drawMainWaveform();
        drawSpectrum();
    }

    function drawMainWaveform() {
        if (!canvasMain || !ctxMain) return;
        
        const width = canvasMain.width / (window.devicePixelRatio || 1);
        const height = canvasMain.height / (window.devicePixelRatio || 1);
        
        // Clear canvas
        ctxMain.clearRect(0, 0, width, height);

        // Draw central grid line (0 amplitude)
        ctxMain.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctxMain.lineWidth = 1;
        ctxMain.beginPath();
        ctxMain.moveTo(0, height / 2);
        ctxMain.lineTo(width, height / 2);
        ctxMain.stroke();

        // Draw grid vertical lines
        const numGridLines = 8;
        for (let i = 1; i < numGridLines; i++) {
            const x = (width / numGridLines) * i;
            ctxMain.beginPath();
            ctxMain.moveTo(x, 0);
            ctxMain.lineTo(x, height);
            ctxMain.stroke();
        }

        // 1. Draw original waveform (Green neon)
        const srcBuffer = audio.sourceBuffer;
        const N = audio.fftSize;

        // Verify if we have active data (not all zeros)
        let hasData = false;
        for (let i = 0; i < N; i++) {
            if (srcBuffer[i] !== 0) {
                hasData = true;
                break;
            }
        }

        if (!hasData) {
            // Draw a flat baseline
            ctxMain.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctxMain.lineWidth = 2;
            ctxMain.beginPath();
            ctxMain.moveTo(0, height / 2);
            ctxMain.lineTo(width, height / 2);
            ctxMain.stroke();
            
            // Draw centered instructions
            ctxMain.fillStyle = '#6b7280';
            ctxMain.font = '14px Inter';
            ctxMain.textAlign = 'center';
            ctxMain.textBaseline = 'middle';
            ctxMain.fillText('音源を録音するか、プリセットを選択してください。', width / 2, height / 2 - 20);
            return;
        }

        // Draw original wave
        ctxMain.strokeStyle = '#00ffcc'; // Original green
        ctxMain.shadowColor = 'rgba(0, 255, 204, 0.3)';
        ctxMain.shadowBlur = 8;
        ctxMain.lineWidth = 2.5;
        ctxMain.beginPath();

        for (let i = 0; i < N; i++) {
            const x = (i / (N - 1)) * width;
            // Map [-1.0, 1.0] to [height, 0]
            const y = (height / 2) - (srcBuffer[i] * (height / 2) * 0.85);
            if (i === 0) {
                ctxMain.moveTo(x, y);
            } else {
                ctxMain.lineTo(x, y);
            }
        }
        ctxMain.stroke();
        ctxMain.shadowBlur = 0; // Reset shadow

        // 2. Draw reconstructed/approximated wave (Magenta neon)
        if (activeIndices.size > 0) {
            const synthBuffer = audio.getSynthesizedWaveform(activeIndices);
            ctxMain.strokeStyle = '#ff007f'; // Synth magenta
            ctxMain.shadowColor = 'rgba(255, 0, 127, 0.3)';
            ctxMain.shadowBlur = 8;
            ctxMain.lineWidth = 2.5;
            ctxMain.beginPath();

            for (let i = 0; i < N; i++) {
                const x = (i / (N - 1)) * width;
                const y = (height / 2) - (synthBuffer[i] * (height / 2) * 0.85);
                if (i === 0) {
                    ctxMain.moveTo(x, y);
                } else {
                    ctxMain.lineTo(x, y);
                }
            }
            ctxMain.stroke();
            ctxMain.shadowBlur = 0; // Reset
        }
    }

    function drawSpectrum() {
        if (!canvasSpectrum || !ctxSpectrum) return;

        const width = canvasSpectrum.width / (window.devicePixelRatio || 1);
        const height = canvasSpectrum.height / (window.devicePixelRatio || 1);
        
        ctxSpectrum.clearRect(0, 0, width, height);

        if (displayComponents.length === 0) {
            ctxSpectrum.fillStyle = '#6b7280';
            ctxSpectrum.font = '14px Inter';
            ctxSpectrum.textAlign = 'center';
            ctxSpectrum.textBaseline = 'middle';
            ctxSpectrum.fillText('音源を録音するか、プリセットを選択してください。', width / 2, height / 2);
            return;
        }

        // Draw grid lines
        ctxSpectrum.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctxSpectrum.lineWidth = 1;
        ctxSpectrum.beginPath();
        for (let i = 1; i <= 5; i++) {
            const y = (height / 5) * i;
            ctxSpectrum.moveTo(0, y);
            ctxSpectrum.lineTo(width, y);
        }
        ctxSpectrum.stroke();

        // Draw spectral bars for displayComponents
        const barWidth = Math.max(12, Math.floor((width / displayComponents.length) * 0.5));
        const spacing = Math.floor((width / displayComponents.length) * 0.5);

        // Find max amplitude among our top ones for visual scaling
        const maxAmp = Math.max(...displayComponents.map(c => c.amp)) || 1.0;

        displayComponents.forEach((comp, idx) => {
            const isChecked = activeIndices.has(comp.index);
            
            // X position
            const x = spacing + idx * (barWidth + spacing);
            
            // Height proportional to amplitude
            const normHeight = (comp.amp / maxAmp) * (height * 0.75);
            const y = height - normHeight - 20;

            // Bar colors: bright magenta if included in synth, dimmed/grayed out if unchecked
            if (isChecked) {
                const gradient = ctxSpectrum.createLinearGradient(x, y, x, height - 20);
                gradient.addColorStop(0, '#ff007f'); // Magenta top
                gradient.addColorStop(1, '#6366f1'); // Indigo bottom
                ctxSpectrum.fillStyle = gradient;
                
                // Add a glowing cap to active bars
                ctxSpectrum.shadowColor = 'rgba(255, 0, 127, 0.4)';
                ctxSpectrum.shadowBlur = 6;
            } else {
                ctxSpectrum.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctxSpectrum.shadowBlur = 0;
            }

            // Draw rounded bar
            ctxSpectrum.beginPath();
            ctxSpectrum.roundRect(x, y, barWidth, normHeight, [4, 4, 0, 0]);
            ctxSpectrum.fill();
            ctxSpectrum.shadowBlur = 0;

            // Label frequency beneath the bar
            ctxSpectrum.fillStyle = isChecked ? '#f3f4f6' : '#6b7280';
            ctxSpectrum.font = '10px Inter';
            ctxSpectrum.textAlign = 'center';
            
            // Format frequency label
            let label = `${comp.freq}Hz`;
            if (comp.freq >= 1000) {
                label = `${(comp.freq / 1000).toFixed(1)}kHz`;
            }
            
            ctxSpectrum.fillText(label, x + barWidth / 2, height - 5);
        });
    }

    /* ==========================================================================
       COMPONENT LIST CONTROLLERS (Right Panel)
       ========================================================================== */

    function renderComponentsList() {
        if (!componentsList) return;
        
        componentsList.innerHTML = '';
        
        if (displayComponents.length === 0) {
            componentsList.innerHTML = `
                <div class="empty-components-message">
                    音源を選択または録音すると、ここに分解された波の要素が表示されます。
                </div>`;
            return;
        }

        // Find max amplitude to compute relative strengths (percentages)
        const maxAmp = Math.max(...displayComponents.map(c => c.amp)) || 1.0;

        displayComponents.forEach((comp, itemIdx) => {
            const isChecked = activeIndices.has(comp.index);
            const relativeStrength = Math.round((comp.amp / maxAmp) * 100);

            // Determine if fundamental or harmonic label
            const typeLabel = itemIdx === 0 ? '基音' : `倍音 ${itemIdx}`;

            // Create row container
            const item = document.createElement('div');
            item.className = `component-item ${isChecked ? 'active-harmonic' : ''}`;
            item.dataset.index = comp.index;

            item.innerHTML = `
                <div class="checkbox-container">
                    <label>
                        <input type="checkbox" ${isChecked ? 'checked' : ''} data-index="${comp.index}">
                        <span class="checkmark"></span>
                    </label>
                </div>
                <div class="comp-info">
                    <div class="comp-freq">${comp.freq} Hz</div>
                    <div class="comp-type" style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${typeLabel}</div>
                </div>
                <div class="comp-amp">
                    強度: <span>${relativeStrength}%</span>
                </div>
                <div class="comp-canvas-container">
                    <canvas id="mini-canvas-${comp.index}"></canvas>
                </div>
                <button class="btn-solo" data-index="${comp.index}">聴く</button>
            `;

            componentsList.appendChild(item);

            // Configure mini canvas immediately
            setTimeout(() => {
                drawMiniWaveform(comp.index, comp.amp / maxAmp, comp.phase);
            }, 10);
        });

        // Attach event listeners to checkboxes
        const checkboxes = componentsList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                const row = e.target.closest('.component-item');
                
                if (e.target.checked) {
                    activeIndices.add(index);
                    if (row) row.classList.add('active-harmonic');
                } else {
                    activeIndices.delete(index);
                    if (row) row.classList.remove('active-harmonic');
                }

                // Update Audio synthesis running coefficients
                if (audio.isPlaying) {
                    audio.updateActiveHarmonics(activeIndices);
                }

                // Redraw main wave displaying the combination
                drawMainWaveform();
                drawSpectrum();
            });
        });

        // Attach event listeners to Solo Preview buttons
        const soloBtns = componentsList.querySelectorAll('.btn-solo');
        soloBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                
                // If there's an active solo playing, stop it first
                if (activeSolo) {
                    activeSolo.stop();
                    document.querySelectorAll('.btn-solo').forEach(b => {
                        b.classList.remove('playing');
                        b.textContent = '聴く';
                    });
                }

                // Play solo tone (sine wave representing this component)
                btn.classList.add('playing');
                btn.textContent = '再生中';
                
                const handle = audio.playSoloTone(index, 1.5);
                activeSolo = {
                    stop: () => {
                        handle.stop();
                        btn.classList.remove('playing');
                        btn.textContent = '聴く';
                    }
                };

                // Revert button text after solo completes
                setTimeout(() => {
                    if (activeSolo && activeSolo.stop === handle.stop) {
                        btn.classList.remove('playing');
                        btn.textContent = '聴く';
                        activeSolo = null;
                    }
                }, 1500);
            });
        });
    }

    /**
     * Renders a clean 1.5 period sine wave on the mini-canvas in the list row.
     */
    function drawMiniWaveform(binIndex, relativeAmp, phase) {
        const canvas = document.getElementById(`mini-canvas-${binIndex}`);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.clientWidth;
        const height = canvas.height = canvas.clientHeight;

        ctx.clearRect(0, 0, width, height);

        // Base axis
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw sine wave
        // We always draw 2 full cycles for aesthetics so users see "wavelength" differences
        // Low index = fewer waves, High index = denser waves.
        // Let's make cycle count proportional to log of bin index to avoid too high density
        const baseCycleCount = 1.5;
        // Let's compute a proportional cycle count so high frequencies look denser
        // Find position of index in our top list
        const listPosition = displayComponents.findIndex(c => c.index === binIndex);
        const cycleFactor = 1 + listPosition * 0.4; // Ranges from 1.0 to ~5.0 cycles
        
        ctx.strokeStyle = '#00e5ff'; // Cyan for clean individual waves
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let x = 0; x < width; x++) {
            const ratio = x / (width - 1);
            // Relative amplitude shapes height (max 85% of half-height)
            const angle = 2 * Math.PI * cycleFactor * ratio + phase;
            const y = (height / 2) - (Math.sin(angle) * (height / 2) * relativeAmp * 0.85);

            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }

    /* ==========================================================================
       USER INPUT INTERACTION CONTROLLERS
       ========================================================================== */

    // 1. Microphone recording handler
    btnRecord.addEventListener('click', async () => {
        // Stop current synthesis playback to prevent acoustic feedback/looping
        stopPlaybackSynth();

        btnRecord.disabled = true;
        btnRecord.classList.add('recording');
        btnRecord.textContent = '準備中...';
        presetSelect.value = '';

        try {
            await audio.startRecording(
                // On Progress (countdown)
                (secondsLeft) => {
                    recordingStatus.classList.remove('hidden');
                    recordCountdown.textContent = secondsLeft;
                    btnRecord.textContent = `録音中 (${secondsLeft}s)`;
                },
                // On Complete (decoding and FFT)
                () => {
                    recordingStatus.classList.add('hidden');
                    btnRecord.classList.remove('recording');
                    btnRecord.disabled = false;
                    btnRecord.textContent = '🎤 マイクで録音';
                    
                    // Run FFT and update graphs/lists
                    processNewAudioSource();
                }
            );
        } catch (err) {
            // Restore button state on failure
            recordingStatus.classList.add('hidden');
            btnRecord.classList.remove('recording');
            btnRecord.disabled = false;
            btnRecord.textContent = '🎤 マイクで録音';
        }
    });

    // 2. Preset dropdown handler
    presetSelect.addEventListener('change', (e) => {
        const type = e.target.value;
        if (!type) return;

        // Stop current synthesis playback
        stopPlaybackSynth();

        // Generate waveform values in buffer
        audio.generatePreset(type);

        // Analyze and render
        processNewAudioSource();
    });

    // 3. Synth Sound playback toggler
    btnPlaySynth.addEventListener('click', () => {
        audio.init();

        if (audio.isPlaying) {
            stopPlaybackSynth();
        } else {
            startPlaybackSynth();
        }
    });

    function startPlaybackSynth() {
        if (activeIndices.size === 0) {
            alert('合成するための周波数成分が1つも選択されていません！');
            return;
        }
        audio.playSynthesis(activeIndices);
        btnPlaySynth.innerHTML = '<span class="play-icon">■</span>再生を停止';
        btnPlaySynth.classList.add('btn-danger');
        btnPlaySynth.classList.remove('btn-primary');
    }

    function stopPlaybackSynth() {
        audio.stopSynthesis();
        btnPlaySynth.innerHTML = '<span class="play-icon">▶</span>合成した音を聴く';
        btnPlaySynth.classList.remove('btn-danger');
        btnPlaySynth.classList.add('btn-primary');
    }

    // 4. Volume slider handler
    volumeSlider.addEventListener('input', (e) => {
        audio.setVolume(parseFloat(e.target.value));
    });

    // 5. Batch selection controls
    btnSelectAll.addEventListener('click', () => {
        if (displayComponents.length === 0) return;
        
        displayComponents.forEach(comp => {
            activeIndices.add(comp.index);
            const cb = componentsList.querySelector(`input[data-index="${comp.index}"]`);
            if (cb) cb.checked = true;
            const row = componentsList.querySelector(`.component-item[data-dataset-index="${comp.index}"]`) || 
                        componentsList.querySelector(`.component-item[data-index="${comp.index}"]`);
            if (row) row.classList.add('active-harmonic');
        });

        if (audio.isPlaying) {
            audio.updateActiveHarmonics(activeIndices);
        }
        
        drawMainWaveform();
        drawSpectrum();
    });

    btnClearAll.addEventListener('click', () => {
        if (displayComponents.length === 0) return;

        activeIndices.clear();
        displayComponents.forEach(comp => {
            const cb = componentsList.querySelector(`input[data-index="${comp.index}"]`);
            if (cb) cb.checked = false;
            const row = componentsList.querySelector(`.component-item[data-index="${comp.index}"]`);
            if (row) row.classList.remove('active-harmonic');
        });

        if (audio.isPlaying) {
            audio.updateActiveHarmonics(activeIndices);
        }

        drawMainWaveform();
        drawSpectrum();
    });
});
