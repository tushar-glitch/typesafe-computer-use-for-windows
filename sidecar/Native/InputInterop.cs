using System.Runtime.InteropServices;

namespace JevSidecar.Native;

/// <summary>
/// SendInput plumbing: the structures Win32 expects, and nothing more.
///
/// SendInput is used rather than mouse_event or SetCursorPos plus a click.
/// Those are superseded, and more importantly SendInput delivers a coherent
/// event sequence that applications treat as genuine user input, which matters
/// for controls that watch for a real press and release pair.
/// </summary>
internal static class InputInterop
{
    internal const uint InputMouse = 0;
    internal const uint InputKeyboard = 1;

    internal const uint MouseeventfMove = 0x0001;
    internal const uint MouseeventfLeftDown = 0x0002;
    internal const uint MouseeventfLeftUp = 0x0004;
    internal const uint MouseeventfWheel = 0x0800;
    internal const uint MouseeventfAbsolute = 0x8000;

    /// <summary>Interpret absolute coordinates against the whole virtual desktop, not the primary monitor.</summary>
    internal const uint MouseeventfVirtualdesk = 0x4000;

    internal const uint KeyeventfKeyup = 0x0002;

    /// <summary>The scan code carries a UTF-16 unit instead of naming a physical key.</summary>
    internal const uint KeyeventfUnicode = 0x0004;

    /// <summary>One notch of the wheel.</summary>
    internal const int WheelDelta = 120;

    /// <summary>The absolute coordinate space SendInput normalises against.</summary>
    internal const double AbsoluteRange = 65535.0;

    [StructLayout(LayoutKind.Sequential)]
    internal struct MouseInput
    {
        public int Dx;
        public int Dy;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct HardwareInput
    {
        public uint Message;
        public ushort ParamL;
        public ushort ParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)]
        public MouseInput Mouse;

        [FieldOffset(0)]
        public KeyboardInput Keyboard;

        [FieldOffset(0)]
        public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Input
    {
        public uint Type;
        public InputUnion Union;
    }

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint SendInput(uint count, [In] Input[] inputs, int size);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetMessageExtraInfo();
}
