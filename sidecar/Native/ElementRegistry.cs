using Interop.UIAutomationClient;

namespace JevSidecar.Native;

/// <summary>
/// Keeps automation elements alive between the walk that found them and the
/// command that acts on one.
///
/// The TypeScript side holds only an opaque string. Elements are grouped by
/// generation — one per walk — and only the two most recent generations are
/// retained, so a handle from the observation the agent is acting on still
/// resolves while older ones are released rather than pinning dead UI forever.
/// </summary>
internal sealed class ElementRegistry
{
    private const int RetainedGenerations = 2;

    private readonly Dictionary<long, Dictionary<string, IUIAutomationElement>> _generations = [];
    private long _generation;
    private long _counter;

    /// <summary>Starts a new generation and retires the oldest. Returns its id.</summary>
    public long BeginGeneration()
    {
        _generation++;
        _generations[_generation] = [];

        foreach (long stale in _generations.Keys.Where(key => key <= _generation - RetainedGenerations).ToList())
        {
            _ = _generations.Remove(stale);
        }

        return _generation;
    }

    public string Add(IUIAutomationElement element)
    {
        string handle = $"e{++_counter}";

        // The generation is created on demand rather than only by a walk.
        // Reading the focused element is a legitimate first call, and it hands
        // back a handle without any tree having been walked.
        if (!_generations.TryGetValue(_generation, out Dictionary<string, IUIAutomationElement>? generation))
        {
            generation = [];
            _generations[_generation] = generation;
        }

        generation[handle] = element;
        return handle;
    }

    /// <summary>The element behind a handle, or null once its generation has been retired.</summary>
    public IUIAutomationElement? Resolve(string handle)
    {
        foreach (Dictionary<string, IUIAutomationElement> generation in _generations.Values)
        {
            if (generation.TryGetValue(handle, out IUIAutomationElement? element))
            {
                return element;
            }
        }

        return null;
    }
}
