/**
 * WaveSynthesis - FFT (Fast Fourier Transform) Algorithm
 * 
 * Cooley-Tukey radix-2 FFT implementation in JavaScript.
 * Suitable for N as power of 2 (e.g. 1024, 2048).
 */

class WaveFFT {
    /**
     * Bit reversal lookup or computation
     */
    static bitReverse(n, bits) {
        let reversed = 0;
        for (let i = 0; i < bits; i++) {
            if ((n & (1 << i)) !== 0) {
                reversed |= (1 << (bits - 1 - i));
            }
        }
        return reversed;
    }

    /**
     * In-place Radix-2 Cooley-Tukey FFT
     * @param {Float32Array} real - Real part array (will be modified in-place)
     * @param {Float32Array} imag - Imaginary part array (will be modified in-place)
     */
    static performFFT(real, imag) {
        const N = real.length;
        if ((N & (N - 1)) !== 0) {
            throw new Error("FFT size must be a power of 2");
        }

        const bits = Math.log2(N);

        // Bit-reversal permutation
        for (let i = 0; i < N; i++) {
            const j = this.bitReverse(i, bits);
            if (i < j) {
                // Swap real
                let temp = real[i];
                real[i] = real[j];
                real[j] = temp;
                // Swap imag
                temp = imag[i];
                imag[i] = imag[j];
                imag[j] = temp;
            }
        }

        // Cooley-Tukey decimation-in-time
        for (let len = 2; len <= N; len <<= 1) {
            const angle = -2 * Math.PI / len;
            const wlen_r = Math.cos(angle);
            const wlen_i = Math.sin(angle);

            for (let i = 0; i < N; i += len) {
                let w_r = 1.0;
                let w_i = 0.0;
                const halfLen = len >> 1;

                for (let j = 0; j < halfLen; j++) {
                    const u_r = real[i + j];
                    const u_i = imag[i + j];

                    // complex multiplication: w * A[i + j + halfLen]
                    const targetIdx = i + j + halfLen;
                    const v_r = real[targetIdx] * w_r - imag[targetIdx] * w_i;
                    const v_i = real[targetIdx] * w_i + imag[targetIdx] * w_r;

                    // Butterfly update
                    real[i + j] = u_r + v_r;
                    imag[i + j] = u_i + v_i;
                    real[targetIdx] = u_r - v_r;
                    imag[targetIdx] = u_i - v_i;

                    // Update weight: w = w * wlen
                    const next_w_r = w_r * wlen_r - w_i * wlen_i;
                    w_i = w_r * wlen_i + w_i * wlen_r;
                    w_r = next_w_r;
                }
            }
        }
    }

    /**
     * Analyzes a time-domain signal buffer and returns frequency components.
     * 
     * @param {Float32Array} timeData - Input signal buffer (length must be power of 2)
     * @param {number} sampleRate - Audio sample rate (e.g. 44100)
     * @returns {Array} List of frequency components sorted by amplitude descending.
     */
    static analyze(timeData, sampleRate) {
        const N = timeData.length;
        const real = new Float32Array(timeData);
        const imag = new Float32Array(N); // initialize with 0s

        // Perform FFT
        this.performFFT(real, imag);

        const components = [];
        const numBins = N / 2; // Nyquist limit

        // Calculate amplitude and phase for each frequency bin
        // Index 0 is DC offset, we typically skip or include it. Let's skip DC (0 Hz).
        for (let k = 1; k < numBins; k++) {
            const r = real[k];
            const im = imag[k];
            
            // Normalized amplitude
            // FFT divides amplitudes by N. For real input, we multiply by 2 (except DC and Nyquist).
            const amp = (2.0 / N) * Math.sqrt(r * r + im * im);
            
            // Phase in radians
            const phase = Math.atan2(im, r);
            
            // Frequency in Hz
            const freq = k * sampleRate / N;

            components.push({
                index: k,
                freq: Math.round(freq * 10) / 10, // Round to 1 decimal place
                amp: amp,
                phase: phase
            });
        }

        return components;
    }
}
