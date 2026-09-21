using System.Runtime.InteropServices;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>
/// Synthetic mouse and keyboard, in physical screen pixels.
///
/// Coordinates are physical pixels throughout, matching capture, window
/// rectangles and UI Automation bounds, because the process declares
/// per-monitor DPI awareness at startup. Nothing here converts between
/// coordinate spaces, and nothing should need to.
/// </summary>
internal static class SyntheticInput
{
    /// <summary>
    /// Named keys the agent may press.
    ///
    /// A closed set on purpose. Arbitrary key injection is a larger capability
    /// than this agent needs, and every member here has an obvious, reversible
    /// meaning in a form or dialog.
    /// </summary>
    private static readonly Dictionary<string, ushort> VirtualKeys = new(StringComparer.Ordinal)
    {
        ["enter"] = 0x0D,
        ["escape"] = 0x1B,
        ["tab"] = 0x09,
        ["backspace"] = 0x08,
        ["delete"] = 0x2E,
    };

    public static void MoveTo(double x, double y) => Send(MouseMove(x, y));

    public static void Click(double x, double y)
    {
        // Move and press as one batch: a separate move can be overtaken by real
        // cursor motion, landing the click somewhere the caller did not choose.
        Send(
            MouseMove(x, y),
            MouseButton(InputInterop.MouseeventfLeftDown),
            MouseButton(InputInterop.MouseeventfLeftUp));
    }

    /// <summary>
    /// Type text as UTF-16 units rather than key presses.
    ///
    /// Sidesteps the keyboard layout entirely: the same call produces the same
    /// characters whatever the user has installed, and characters absent from
    /// their layout still arrive.
    /// </summary>
    public static void TypeText(string text)
    {
        if (text.Length == 0)
        {
            return;
        }

        List<InputInterop.Input> batch = new(text.Length * 2);
        foreach (char unit in text)
        {
            batch.Add(UnicodeKey(unit, down: true));
            batch.Add(UnicodeKey(unit, down: false));
        }

        Send([.. batch]);
    }

    public static void PressKey(string name)
    {
        if (!VirtualKeys.TryGetValue(name, out ushort code))
        {
            throw new SidecarCommandException("unknown-key", $"no virtual key named '{name}'");
        }

        Send(VirtualKey(code, down: true), VirtualKey(code, down: false));
    }

    /// <summary>
    /// Scroll the view under the cursor.
    ///
    /// Wheel events go wherever the pointer happens to be, so the cursor is
    /// first parked over the centre of the foreground window. Without that, a
    /// scroll aimed at the page can land in whatever sits beneath the mouse.
    /// </summary>
    public static void Scroll(int notches)
    {
        IntPtr window = NativeMethods.GetForegroundWindow();
        if (window != IntPtr.Zero)
        {
            NativeMethods.Rect frame = WindowProbe.FrameBounds(window);
            Send(MouseMove(frame.Left + (frame.Width / 2.0), frame.Top + (frame.Height / 2.0)));
        }

        InputInterop.Input wheel = new()
        {
            Type = InputInterop.InputMouse,
            Union = new InputInterop.InputUnion
            {
                Mouse = new InputInterop.MouseInput
                {
                    MouseData = unchecked((uint)(notches * InputInterop.WheelDelta)),
                    Flags = InputInterop.MouseeventfWheel,
                    ExtraInfo = InputInterop.GetMessageExtraInfo(),
                },
            },
        };

        Send(wheel);
    }

    /// <summary>Select all, then delete. Used to undo a fill that did not take.</summary>
    public static void ClearFocusedField()
    {
        const ushort control = 0x11;
        const ushort keyA = 0x41;

        Send(
            VirtualKey(control, down: true),
            VirtualKey(keyA, down: true),
            VirtualKey(keyA, down: false),
            VirtualKey(control, down: false));

        PressKey("delete");
    }

    /// <summary>
    /// Absolute pointer coordinates, normalised across every monitor.
    ///
    /// SendInput expects 0 to 65535 spanning the virtual desktop, so a point on
    /// a secondary display, which may be at negative coordinates, has to be
    /// expressed relative to the virtual origin rather than to zero.
    /// </summary>
    private static InputInterop.Input MouseMove(double x, double y)
    {
        NativeMethods.Rect virtualScreen = NativeMethods.VirtualScreen();
        double width = Math.Max(1, virtualScreen.Width);
        double height = Math.Max(1, virtualScreen.Height);

        double normalizedX = (x - virtualScreen.Left) * InputInterop.AbsoluteRange / width;
        double normalizedY = (y - virtualScreen.Top) * InputInterop.AbsoluteRange / height;

        return new InputInterop.Input
        {
            Type = InputInterop.InputMouse,
            Union = new InputInterop.InputUnion
            {
                Mouse = new InputInterop.MouseInput
                {
                    Dx = (int)Math.Round(Math.Clamp(normalizedX, 0, InputInterop.AbsoluteRange)),
                    Dy = (int)Math.Round(Math.Clamp(normalizedY, 0, InputInterop.AbsoluteRange)),
                    Flags = InputInterop.MouseeventfMove
                        | InputInterop.MouseeventfAbsolute
                        | InputInterop.MouseeventfVirtualdesk,
                    ExtraInfo = InputInterop.GetMessageExtraInfo(),
                },
            },
        };
    }

    private static InputInterop.Input MouseButton(uint flag) => new()
    {
        Type = InputInterop.InputMouse,
        Union = new InputInterop.InputUnion
        {
            Mouse = new InputInterop.MouseInput
            {
                Flags = flag,
                ExtraInfo = InputInterop.GetMessageExtraInfo(),
            },
        },
    };

    private static InputInterop.Input UnicodeKey(char unit, bool down) => new()
    {
        Type = InputInterop.InputKeyboard,
        Union = new InputInterop.InputUnion
        {
            Keyboard = new InputInterop.KeyboardInput
            {
                VirtualKey = 0,
                ScanCode = unit,
                Flags = InputInterop.KeyeventfUnicode | (down ? 0 : InputInterop.KeyeventfKeyup),
                ExtraInfo = InputInterop.GetMessageExtraInfo(),
            },
        },
    };

    private static InputInterop.Input VirtualKey(ushort code, bool down) => new()
    {
        Type = InputInterop.InputKeyboard,
        Union = new InputInterop.InputUnion
        {
            Keyboard = new InputInterop.KeyboardInput
            {
                VirtualKey = code,
                Flags = down ? 0 : InputInterop.KeyeventfKeyup,
                ExtraInfo = InputInterop.GetMessageExtraInfo(),
            },
        },
    };

    /// <summary>
    /// Hand a batch to Win32 and insist it was accepted.
    ///
    /// A partial or refused send is usually UIPI: a process at a higher
    /// integrity level, such as an elevated window, silently discards input
    /// from this one. Reporting it beats an action that appears to succeed and
    /// changes nothing.
    /// </summary>
    private static void Send(params InputInterop.Input[] inputs)
    {
        uint sent = InputInterop.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<InputInterop.Input>());
        if (sent != inputs.Length)
        {
            int error = Marshal.GetLastWin32Error();
            throw new SidecarCommandException(
                "input-blocked",
                $"Windows accepted {sent} of {inputs.Length} events (error {error}). "
                    + "The target window is most likely running elevated.");
        }
    }
}
