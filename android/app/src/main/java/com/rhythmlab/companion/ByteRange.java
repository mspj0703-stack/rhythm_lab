package com.rhythmlab.companion;

/** Single HTTP byte range. Invalid/unsatisfiable ranges are represented by null. */
public final class ByteRange {
    public final long start;
    public final long end;
    private ByteRange(long start, long end) { this.start = start; this.end = end; }
    public static ByteRange parse(String header, long size) {
        if (size <= 0 || header == null || !header.startsWith("bytes=")) return null;
        String value = header.substring(6).trim();
        if (!value.matches("[0-9]*-[0-9]*")) return null;
        String[] parts = value.split("-", -1);
        try {
            if (parts[0].isEmpty()) {
                long suffix = Long.parseLong(parts[1]);
                return suffix > 0 ? new ByteRange(Math.max(0, size - suffix), size - 1) : null;
            }
            long start = Long.parseLong(parts[0]);
            long end = parts[1].isEmpty() ? size - 1 : Math.min(Long.parseLong(parts[1]), size - 1);
            return start < size && end >= start ? new ByteRange(start, end) : null;
        } catch (NumberFormatException e) { return null; }
    }
}
