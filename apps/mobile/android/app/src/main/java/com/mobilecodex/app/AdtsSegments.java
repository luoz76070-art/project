package com.mobilecodex.app;

/**
 * V5: long recordings are transcribed in pieces while they go on. The recorder writes AAC as ADTS, a run of
 * frames that each carry their own header, so a piece is just whole frames cut from the growing file: the
 * recorder never stops and nothing is lost between pieces. Pure Java so it is tested without Android.
 */
final class AdtsSegments {
    /** Samples in one AAC frame; at 16 kHz a frame is 64 ms. */
    static final int FRAME_SAMPLES = 1024;

    private AdtsSegments() { }

    /**
     * Length of the frame that starts at {@code offset}: 0 when it is not all in {@code data[offset, limit)}
     * yet, -1 when the bytes there are not an ADTS frame.
     */
    static int frameLength(byte[] data, int offset, int limit) {
        if (limit - offset < 7) return 0;
        if ((data[offset] & 0xFF) != 0xFF || (data[offset + 1] & 0xF6) != 0xF0) return -1;
        int length = ((data[offset + 3] & 0x03) << 11) | ((data[offset + 4] & 0xFF) << 3) | ((data[offset + 5] & 0xE0) >>> 5);
        if (length < 7) return -1;
        return offset + length <= limit ? length : 0;
    }

    /**
     * Whole frames at the start of {@code data[0, limit)}, at most {@code maxFrames} of them: returns
     * {frames, bytes}. A frame still being written ends the count; a broken stream throws.
     */
    static int[] whole(byte[] data, int limit, int maxFrames) {
        int frames = 0, bytes = 0;
        while (frames < maxFrames) {
            int length = frameLength(data, bytes, limit);
            if (length < 0) throw new IllegalStateException("not an ADTS stream");
            if (length == 0) break;
            bytes += length; frames++;
        }
        return new int[] { frames, bytes };
    }

    /** Frames that cover {@code ms} milliseconds of audio at {@code sampleRate}. */
    static long framesAt(long ms, int sampleRate) {
        return ms * sampleRate / (1000L * FRAME_SAMPLES);
    }

    /** Milliseconds that {@code frames} frames last at {@code sampleRate}. */
    static long durationOf(long frames, int sampleRate) {
        return frames * FRAME_SAMPLES * 1000L / sampleRate;
    }

    /**
     * Where to end the piece that began at {@code start} (ms since recording began), or -1 to keep going.
     * {@code times[i]} is when amplitude sample i was taken and {@code amps[i]} the loudest level in the
     * {@code tick} ms before it. A piece ends at the first quiet moment after {@code shortest} ms, and at the
     * {@code longest} ms at the quietest moment it had after {@code shortest}, so words are rarely cut.
     */
    static long cutAt(long[] times, int[] amps, int count, long start, long now, long shortest, long longest, long tick) {
        if (now - start < shortest || count == 0) return -1;
        long sum = 0; int counted = 0;
        for (int i = 0; i < count; i++) if (times[i] > start) { sum += amps[i]; counted++; }
        int quiet = Math.max(300, counted == 0 ? 0 : (int) (sum / counted / 6));
        int last = count - 1;
        if (times[last] - start >= shortest && amps[last] <= quiet) return times[last] - tick / 2;
        if (now - start < longest) return -1;
        int best = -1;
        for (int i = 0; i < count; i++) {
            if (times[i] - start < shortest) continue;
            if (best < 0 || amps[i] < amps[best]) best = i;
        }
        return best < 0 ? now : times[best] - tick / 2;
    }
}
