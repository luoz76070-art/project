package com.mobilecodex.app;

import java.io.ByteArrayOutputStream;

public final class AdtsSegmentsTest {
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }

    private static byte[] frame(int length) {
        byte[] frame = new byte[length];
        frame[0] = (byte) 0xFF; frame[1] = (byte) 0xF1; frame[2] = (byte) 0x60;
        frame[3] = (byte) (0x40 | ((length >> 11) & 0x03));
        frame[4] = (byte) ((length >> 3) & 0xFF);
        frame[5] = (byte) (((length & 0x07) << 5) | 0x1F);
        frame[6] = (byte) 0xFC;
        for (int i = 7; i < length; i++) frame[i] = (byte) i;
        return frame;
    }

    public static void main(String[] args) {
        ByteArrayOutputStream stream = new ByteArrayOutputStream();
        int[] sizes = { 120, 97, 300, 64 };
        for (int size : sizes) { byte[] f = frame(size); stream.write(f, 0, f.length); }
        byte[] data = stream.toByteArray();

        int[] all = AdtsSegments.whole(data, data.length, Integer.MAX_VALUE);
        check(all[0] == 4 && all[1] == 581, "counts every whole frame");
        int[] two = AdtsSegments.whole(data, data.length, 2);
        check(two[0] == 2 && two[1] == 217, "stops at the frame limit");
        int[] partial = AdtsSegments.whole(data, data.length - 10, Integer.MAX_VALUE);
        check(partial[0] == 3 && partial[1] == 517, "a frame still being written is left for later");
        int[] header = AdtsSegments.whole(data, 120 + 5, Integer.MAX_VALUE);
        check(header[0] == 1 && header[1] == 120, "a partial header is left for later");
        byte[] broken = data.clone(); broken[120] = 0x12;
        boolean threw = false;
        try { AdtsSegments.whole(broken, broken.length, Integer.MAX_VALUE); } catch (IllegalStateException expected) { threw = true; }
        check(threw, "a broken stream is reported, not skipped");

        check(AdtsSegments.framesAt(30_000, 16_000) == 468, "30 s at 16 kHz is 468 whole frames");
        check(AdtsSegments.durationOf(468, 16_000) == 29_952, "468 frames last 29.952 s");

        long[] times = new long[400]; int[] amps = new int[400];
        int n = 0;
        for (long t = 100; t <= 24_000; t += 100) { times[n] = t; amps[n++] = 4000; }
        check(AdtsSegments.cutAt(times, amps, n, 0, 24_000, 25_000, 35_000, 100) == -1, "never before the shortest piece");
        for (long t = 24_100; t <= 26_000; t += 100) { times[n] = t; amps[n++] = 4000; }
        check(AdtsSegments.cutAt(times, amps, n, 0, 26_000, 25_000, 35_000, 100) == -1, "speech goes on after 25 s");
        times[n] = 26_100; amps[n++] = 200;
        check(AdtsSegments.cutAt(times, amps, n, 0, 26_100, 25_000, 35_000, 100) == 26_050, "cuts at the first quiet moment after 25 s");

        n = 0;
        for (long t = 100; t <= 35_000; t += 100) { times[n] = t; amps[n++] = t == 31_000 ? 2500 : 5000; }
        check(AdtsSegments.cutAt(times, amps, n, 0, 34_900, 25_000, 35_000, 100) == -1, "waits for quiet until the longest piece");
        check(AdtsSegments.cutAt(times, amps, n, 0, 35_000, 25_000, 35_000, 100) == 30_950, "at 35 s cuts at the quietest moment after 25 s");
        check(AdtsSegments.cutAt(times, amps, n, 10_000, 35_000, 25_000, 35_000, 100) == -1, "measured from where the piece began");
        System.out.println("AdtsSegmentsTest passed");
    }
}
