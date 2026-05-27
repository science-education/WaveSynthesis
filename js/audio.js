/**
 * WaveSynthesis - Web Audio API management
 * Handles microphone recording, preset waveform generation, and synthesis playback.
 */

class WaveAudio {
    constructor() {
        this.audioCtx = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.sampleRate = 44100; // Default fallback
        this.fftSize = 2048;
        
        // Playback nodes
        this.oscNode = null;
        this.gainNode = null;
        this.isPlaying = false;
        
        // Analyzed active waveform data (2048 floats)
        this.sourceBuffer = new Float32Array(this.fftSize);
        // Full raw FFT results (real and imag) of the current source
        this.fftReal = null;
        this.fftImag = null;
    }

    /**
     * Initialize AudioContext on user gesture
     */
    init() {
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContextClass();
            this.sampleRate = this.audioCtx.sampleRate;
            
            // Setup main gain node
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = 0.5; // Default volume
            this.gainNode.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    /**
     * Start recording from microphone for a fixed duration (3 seconds)
     */
    async startRecording(onProgress, onComplete) {
        this.init();
        this.recordedChunks = [];

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.mediaRecorder = new MediaRecorder(stream);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                // Stop all tracks on the stream to release the mic
                stream.getTracks().forEach(track => track.stop());
                
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                
                // Decode audio data
                this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                    const channelData = decodedBuffer.getChannelData(0); // Mono channel
                    this.extractFrame(channelData);
                    onComplete();
                }, (err) => {
                    console.error("Decoding error: ", err);
                    alert("音声データのデコードに失敗しました。");
                });
            };

            // Start recording
            this.mediaRecorder.start();
            
            let secondsLeft = 3;
            onProgress(secondsLeft);
            
            const interval = setInterval(() => {
                secondsLeft--;
                if (secondsLeft > 0) {
                    onProgress(secondsLeft);
                } else {
                    clearInterval(interval);
                    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.stop();
                    }
                }
            }, 1000);

        } catch (err) {
            console.error("Microphone access denied: ", err);
            alert("マイクへのアクセスが拒否されたか、マイクが見つかりません。");
            throw err;
        }
    }

    /**
     * Extract a representative 2048-sample frame from recorded audio.
     * Looks for the region with the highest energy/amplitude to get a clear waveform.
     */
    extractFrame(channelData) {
        const N = this.fftSize;
        if (channelData.length <= N) {
            // Audio is too short, pad with zeros
            this.sourceBuffer.fill(0);
            this.sourceBuffer.set(channelData);
            return;
        }

        // Find the window of size N with the maximum sum of absolute values
        let maxEnergy = 0;
        let maxIdx = 0;
        
        // Step through the audio buffer
        const step = Math.max(1, Math.floor(channelData.length / 100)); // Sample 100 points
        for (let i = 0; i < channelData.length - N; i += step) {
            let energy = 0;
            for (let j = 0; j < N; j++) {
                energy += Math.abs(channelData[i + j]);
            }
            if (energy > maxEnergy) {
                maxEnergy = energy;
                maxIdx = i;
            }
        }

        // Copy that frame to sourceBuffer
        for (let i = 0; i < N; i++) {
            this.sourceBuffer[i] = channelData[maxIdx + i];
        }

        // Apply a gentle fade-in / fade-out to prevent clicks at boundaries (Tukey window light)
        const fadeLength = Math.floor(N * 0.05); // 5% fade at edges
        for (let i = 0; i < fadeLength; i++) {
            const scale = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLength));
            this.sourceBuffer[i] *= scale;
            this.sourceBuffer[N - 1 - i] *= scale;
        }
    }

    /**
     * Generate standard/simulated waveforms in sourceBuffer
     */
    generatePreset(type) {
        const N = this.fftSize;
        const sr = this.sampleRate;
        this.sourceBuffer.fill(0);

        // Define a fundamental frequency for preset synthesis
        // We want a clear tone, e.g., A3 (220 Hz) or middle C (261.63 Hz). Let's use A3 = 220Hz.
        const f0 = 220.0;
        
        for (let i = 0; i < N; i++) {
            const t = i / sr;
            
            switch (type) {
                case 'sine':
                    // Simple sine wave
                    this.sourceBuffer[i] = Math.sin(2 * Math.PI * f0 * t);
                    break;
                    
                case 'square':
                    // Square wave: infinite odd harmonics (1/n amplitude)
                    // Synthesized mathematically to avoid aliasing issues in raw buffer
                    let sq = 0;
                    for (let h = 1; h < 25; h += 2) {
                        sq += (1 / h) * Math.sin(2 * Math.PI * f0 * h * t);
                    }
                    this.sourceBuffer[i] = sq * 1.2; // Normalize slightly
                    break;
                    
                case 'sawtooth':
                    // Sawtooth wave: all harmonics (1/n amplitude, alternate signs or phases)
                    let saw = 0;
                    for (let h = 1; h < 25; h++) {
                        saw += (1 / h) * Math.sin(2 * Math.PI * f0 * h * t) * (h % 2 === 0 ? -1 : 1);
                    }
                    this.sourceBuffer[i] = saw * 0.8;
                    break;
                    
                case 'triangle':
                    // Triangle wave: odd harmonics (1/n^2 amplitude, alternating phase)
                    let tri = 0;
                    for (let h = 1; h < 15; h += 2) {
                        const sign = ((h - 1) / 2) % 2 === 0 ? 1 : -1;
                        tri += (sign / (h * h)) * Math.sin(2 * Math.PI * f0 * h * t);
                    }
                    this.sourceBuffer[i] = tri * 1.4;
                    break;

                case 'violin':
                    // Violin-like tone: strong odd and even harmonics with specific dropoff
                    // Rich spectrum, simulating string resonance
                    let v = 0;
                    const harmonics = [
                        { h: 1, a: 1.0 },   // Fundamental
                        { h: 2, a: 0.8 },   // Octave
                        { h: 3, a: 0.6 },
                        { h: 4, a: 0.5 },
                        { h: 5, a: 0.3 },
                        { h: 6, a: 0.4 },   // formant peak
                        { h: 7, a: 0.1 },
                        { h: 8, a: 0.2 },
                        { h: 9, a: 0.15 },
                        { h: 10, a: 0.05 }
                    ];
                    for (const harm of harmonics) {
                        v += harm.a * Math.sin(2 * Math.PI * f0 * harm.h * t + (harm.h * 0.2));
                    }
                    this.sourceBuffer[i] = v * 0.4;
                    break;

                case 'voice_a':
                    // Simulated vowel "a" (Japanese "あ")
                    // Typical male voice fundamental (e.g. 130 Hz) + Formants F1 (700Hz), F2 (1200Hz)
                    const f0_voice = 130.0;
                    let voice = 0;
                    // Add harmonics up to Nyquist, but shape with vocal tract filter envelopes (Formants)
                    // Simple resonant filters simulation:
                    const f1 = 700;  // First formant
                    const f2 = 1200; // Second formant
                    const bw = 100;  // Formant bandwidth
                    
                    for (let h = 1; h < 35; h++) {
                        const freq = f0_voice * h;
                        // Formant filter gain (resonance curves)
                        const g1 = 1 / (1 + Math.pow((freq - f1) / bw, 2));
                        const g2 = 0.5 / (1 + Math.pow((freq - f2) / bw, 2));
                        const amp = (g1 + g2 + 0.05) / h; // 1/h natural decay + formant boost
                        
                        voice += amp * Math.sin(2 * Math.PI * freq * t + Math.random() * 0.1);
                    }
                    this.sourceBuffer[i] = voice * 0.7;
                    break;
            }
        }
        
        // Normalize buffer to peak at +/-0.9
        let maxVal = 0;
        for (let i = 0; i < N; i++) {
            maxVal = Math.max(maxVal, Math.abs(this.sourceBuffer[i]));
        }
        if (maxVal > 0) {
            for (let i = 0; i < N; i++) {
                this.sourceBuffer[i] = (this.sourceBuffer[i] / maxVal) * 0.9;
            }
        }
    }

    /**
     * Runs FFT on the current sourceBuffer and stores raw complex values.
     */
    analyzeSource() {
        const N = this.fftSize;
        
        // We need both real and imag values to recreate the PeriodicWave.
        // Let's compute them manually via a standard FFT on the sourceBuffer.
        this.fftReal = new Float32Array(this.sourceBuffer);
        this.fftImag = new Float32Array(N); // 0 initial
        
        // Perform the FFT in-place (this updates fftReal and fftImag)
        WaveFFT.performFFT(this.fftReal, this.fftImag);
    }

    /**
     * Starts looping the synthesized wave based on selected components.
     * Uses PeriodicWave and OscillatorNode for smooth, click-free real-time synthesis.
     * 
     * @param {Set<number>} activeIndices - Set of frequency bin indices that are enabled
     */
    playSynthesis(activeIndices) {
        this.init();
        this.stopSynthesis();

        const N = this.fftSize;
        const numBins = N / 2;
        
        // Web Audio PeriodicWave requires real and imag parts starting from DC (index 0).
        // Since Web Audio API uses Cosine (real) and Sine (imag) coefficients:
        // PeriodicWave real coeff = FFT real / (N/2) (approximately, sign depends on FFT definition)
        // Web Audio uses standard: A*cos + B*sin
        // FFT output is: X[k] = Real[k] - j*Imag[k]
        // PeriodicWave expects real[k] = a_k (cosine term), imag[k] = b_k (sine term)
        // For FFT buffer:
        // x[n] = (1/N) * sum_{k=0}^{N-1} (Real[k] + j*Imag[k]) * e^{j 2pi k n / N}
        // Since x[n] is real, this simplifies to:
        // x[n] = (1/N) * (Real[0] + Real[N/2]cos(pi n) + 2 * sum_{k=1}^{N/2-1} (Real[k]cos(2pi k n/N) - Imag[k]sin(2pi k n/N)))
        // So for PeriodicWave:
        // real[k] = 2 * Real[k] / N
        // imag[k] = -2 * Imag[k] / N
        
        const realCoeffs = new Float32Array(numBins);
        const imagCoeffs = new Float32Array(numBins);
        
        // Web Audio API spec: index 0 (DC offset) must be 0
        realCoeffs[0] = 0;
        imagCoeffs[0] = 0;

        for (let k = 1; k < numBins; k++) {
            if (activeIndices.has(k)) {
                // Scale coefficients properly for PeriodicWave
                realCoeffs[k] = (2.0 / N) * this.fftReal[k];
                // Note: FFT imag values are inverted relative to standard sine coefficients depending on definition.
                // We use negative imag from FFT to match the phase properly.
                imagCoeffs[k] = -(2.0 / N) * this.fftImag[k];
            } else {
                realCoeffs[k] = 0;
                imagCoeffs[k] = 0;
            }
        }

        // Create the custom periodic wave
        // Disable normalization so that amplitude perfectly reflects the coefficients sum
        const wave = this.audioCtx.createPeriodicWave(realCoeffs, imagCoeffs, { disableNormalization: false });

        // Setup oscillator
        this.oscNode = this.audioCtx.createOscillator();
        this.oscNode.setPeriodicWave(wave);
        
        // Calculate fundamental frequency of the buffer cycle
        // If the sample rate is 44100 and buffer size is 2048, one full loop is 2048/44100 seconds.
        // Therefore, the fundamental frequency is 44100 / 2048 = 21.5332 Hz.
        // Playing the PeriodicWave at this frequency reproduces the original sample buffer pitch exactly.
        const fundFreq = this.sampleRate / N;
        this.oscNode.frequency.value = fundFreq;
        
        // Connect and start
        this.oscNode.connect(this.gainNode);
        this.oscNode.start();
        this.isPlaying = true;
    }

    /**
     * Dynamic update of the active harmonics while playing, avoiding pops/clicks.
     * We just build a new periodic wave and swap it on the running oscillator.
     */
    updateActiveHarmonics(activeIndices) {
        if (!this.isPlaying || !this.oscNode) return;

        const N = this.fftSize;
        const numBins = N / 2;
        
        const realCoeffs = new Float32Array(numBins);
        const imagCoeffs = new Float32Array(numBins);
        
        realCoeffs[0] = 0;
        imagCoeffs[0] = 0;

        for (let k = 1; k < numBins; k++) {
            if (activeIndices.has(k)) {
                realCoeffs[k] = (2.0 / N) * this.fftReal[k];
                imagCoeffs[k] = -(2.0 / N) * this.fftImag[k];
            } else {
                realCoeffs[k] = 0;
                imagCoeffs[k] = 0;
            }
        }

        const wave = this.audioCtx.createPeriodicWave(realCoeffs, imagCoeffs, { disableNormalization: false });
        this.oscNode.setPeriodicWave(wave);
    }

    /**
     * Stop synthesizing sound
     */
    stopSynthesis() {
        if (this.isPlaying && this.oscNode) {
            try {
                this.oscNode.stop();
                this.oscNode.disconnect();
            } catch (e) {
                // Ignore if already stopped
            }
            this.oscNode = null;
            this.isPlaying = false;
        }
    }

    /**
     * Sets the synthesizer master volume
     * @param {number} val - Volume between 0.0 and 1.0
     */
    setVolume(val) {
        if (this.gainNode) {
            // Smooth volume transition to prevent pops
            this.gainNode.gain.setTargetAtTime(val, this.audioCtx ? this.audioCtx.currentTime : 0, 0.01);
        }
    }

    /**
     * Generates a single cycle of the synthesized waveform for display on Canvas.
     * Evaluates: y(t) = Sum_{k in active} ( A_k * cos(2pi k t + phase_k) )
     * or simply executes Inverse DFT on the selected coefficients.
     * 
     * @param {Set<number>} activeIndices - Set of active bin indices
     * @returns {Float32Array} Synthesized wave buffer of size 2048
     */
    getSynthesizedWaveform(activeIndices) {
        const N = this.fftSize;
        const synthBuffer = new Float32Array(N);

        // Standard inverse FFT (IFFT) can be done, but for arbitrary subset it's simple to:
        // y[n] = (1/N) * sum_{k=0}^{N-1} X[k] * e^{j 2pi k n / N}
        // Since the signal is real and symmetric:
        // y[n] = (Real[0] + Real[N/2]cos(pi n))/N + (2/N)*sum_{k=1}^{N/2-1} (Real[k]*cos(2pi k n / N) - Imag[k]*sin(2pi k n / N))
        // This is exact and fast enough for 2048 samples if we only sum active indices (max ~15-20 indices).
        
        const activeArray = Array.from(activeIndices);
        
        for (let n = 0; n < N; n++) {
            let val = 0;
            
            // Add DC components if active (usually not in our UI list, but for safety)
            if (activeIndices.has(0)) {
                val += this.fftReal[0] / N;
            }
            
            for (let i = 0; i < activeArray.length; i++) {
                const k = activeArray[i];
                if (k === 0 || k >= N/2) continue;
                
                const angle = (2 * Math.PI * k * n) / N;
                // Cosine part (real) and Sine part (-imag)
                val += (2.0 / N) * (this.fftReal[k] * Math.cos(angle) - this.fftImag[k] * Math.sin(angle));
            }
            
            synthBuffer[n] = val;
        }

        return synthBuffer;
    }

    /**
     * Play a short solo tone for a specific single component (frequency k)
     * For auditory preview of a single harmonic.
     */
    playSoloTone(freqBinIndex, duration = 1.5) {
        this.init();
        
        const N = this.fftSize;
        const tempCtx = this.audioCtx;
        
        // Single oscillator for the frequency
        const osc = tempCtx.createOscillator();
        const gain = tempCtx.createGain();
        
        // Calculate exact frequency
        const freq = freqBinIndex * this.sampleRate / N;
        osc.frequency.value = freq;
        
        // Calculate amplitude relative to full range
        const amp = (2.0 / N) * Math.sqrt(
            this.fftReal[freqBinIndex] * this.fftReal[freqBinIndex] + 
            this.fftImag[freqBinIndex] * this.fftImag[freqBinIndex]
        );
        
        // Set volume with quick fade in/out
        gain.gain.setValueAtTime(0, tempCtx.currentTime);
        gain.gain.linearRampToValueAtTime(Math.min(0.5, amp * 1.5), tempCtx.currentTime + 0.05); // Boost quiet harmonics slightly for hearing
        gain.gain.setValueAtTime(Math.min(0.5, amp * 1.5), tempCtx.currentTime + duration - 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, tempCtx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(tempCtx.destination);
        
        osc.start();
        osc.stop(tempCtx.currentTime + duration);
        
        return {
            stop: () => {
                try {
                    osc.stop();
                    osc.disconnect();
                } catch(e) {}
            }
        };
    }
}
