import com.rhythmlab.companion.ByteRange;

public class ByteRangeTest {
    private static int count;
    private static void valid(String h, long size, long start, long end) {
        ByteRange r = ByteRange.parse(h, size);
        if (r == null || r.start != start || r.end != end) throw new AssertionError(h);
        count++;
    }
    private static void invalid(String h, long size) {
        if (ByteRange.parse(h, size) != null) throw new AssertionError(h);
        count++;
    }
    public static void main(String[] args) {
        valid("bytes=0-", 100, 0, 99);
        valid("bytes=20-50", 100, 20, 50);
        valid("bytes=90-200", 100, 90, 99);
        valid("bytes=-20", 100, 80, 99);
        valid("bytes=-200", 100, 0, 99);
        valid("bytes=99-99", 100, 99, 99);
        invalid("bytes=100-", 100);
        invalid("bytes=50-20", 100);
        invalid("bytes=-0", 100);
        invalid("bytes=-", 100);
        invalid("bytes=0-1,3-4", 100);
        invalid("bytes=999999999999999999999-", 100);
        invalid("bytes=0-", 0);
        invalid(null, 100);
        System.out.println(count + " range cases PASS");
    }
}
