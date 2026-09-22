using System.IO;
using NAudio.Wave;

namespace JevSidecar.Native;

/// <summary>
/// Streams the microphone to stdout as raw PCM.
///
/// A separate mode of the same executable rather than a command on the JSON
/// channel: audio is a continuous binary stream, and framing it as JSON lines
/// would mean base64 and a copy per chunk, forever. Here stdout carries
/// nothing but samples, so the parent reads it as the byte stream it is, and
/// every diagnostic goes to stderr.
///
/// The format is what streaming recognisers expect: 16 kHz, 16-bit, mono,
/// little-endian. Enough for speech, and a third of the bytes of 48 kHz.
/// </summary>
internal static class MicrophoneCapture
{
    private const int SampleRate = 16_000;
    private const int BitsPerSample = 16;
    private const int Channels = 1;

    /// <summary>
    /// How much audio accumulates before a buffer is handed over.
    ///
    /// Small, because this delay is added to every transcript: the recogniser
    /// cannot report a word it has not received. Too small and the overhead per
    /// callback starts to dominate.
    /// </summary>
    private const int BufferMilliseconds = 50;

    public static int Run()
    {
        if (WaveInEvent.DeviceCount == 0)
        {
            Console.Error.WriteLine("no microphone found; check Windows sound settings and privacy permissions");
            return 2;
        }

        using Stream stdout = Console.OpenStandardOutput();
        using WaveInEvent microphone = new()
        {
            WaveFormat = new WaveFormat(SampleRate, BitsPerSample, Channels),
            BufferMilliseconds = BufferMilliseconds,
        };

        // Signalled when capture ends, however it ends.
        using ManualResetEventSlim finished = new(false);
        Exception? failure = null;

        microphone.DataAvailable += (_, args) =>
        {
            try
            {
                stdout.Write(args.Buffer, 0, args.BytesRecorded);
                stdout.Flush();
            }
            catch (IOException)
            {
                // The parent closed the pipe, which is how it says stop.
                finished.Set();
            }
        };

        microphone.RecordingStopped += (_, args) =>
        {
            failure = args.Exception;
            finished.Set();
        };

        Console.Error.WriteLine(
            $"capturing {SampleRate}Hz {BitsPerSample}-bit mono from {WaveInEvent.GetCapabilities(0).ProductName}");

        try
        {
            microphone.StartRecording();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"could not start capture: {error.Message}");
            return 3;
        }

        // Stop when the parent closes stdin, which happens when it exits or
        // deliberately shuts the stream. Waiting on the console read costs
        // nothing while audio flows on the callback thread.
        Thread watcher = new(() =>
        {
            try
            {
                while (Console.In.Read() >= 0)
                {
                    // Nothing is sent on this channel; only its closing matters.
                }
            }
            catch (IOException)
            {
                // Treated the same as a clean close.
            }

            finished.Set();
        })
        {
            IsBackground = true,
        };
        watcher.Start();

        finished.Wait();
        microphone.StopRecording();

        if (failure is not null)
        {
            Console.Error.WriteLine($"capture ended with an error: {failure.Message}");
            return 4;
        }

        Console.Error.WriteLine("capture stopped");
        return 0;
    }
}
