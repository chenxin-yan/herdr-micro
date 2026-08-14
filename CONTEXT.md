# herdr-micro

herdr-micro is a physical control deck for observing and controlling coding agents managed by Herdr.

## Language

**Deck**:
The Adafruit MacroPad RP2040 running the herdr-micro device bundle.
_Avoid_: MacroPad, controller, device

**Fleet**:
The coding agents available to the Deck through one Herdr Target.
_Avoid_: Processes, terminals

**Herdr Target**:
One Herdr server namespace selected by host and Session. Targets do not share agents, identifiers, or focus.
_Avoid_: Window, Herdr instance

**Session**:
A persistent Herdr server namespace containing Workspaces, tabs, panes, and agents. A Session is not an attached terminal window.
_Avoid_: Window, client

**Workspace**:
Herdr's top-level project container within a Session. Herdr's UI labels Workspaces as “spaces.”
_Avoid_: Session

**Agent State**:
Herdr's semantic classification of an agent as `idle`, `working`, `blocked`, `done`, or `unknown`. Colors and animations are Deck presentation, not additional states.
_Avoid_: LED state, completion status

**Agent Slot**:
One of six Deck keys that represents an agent and displays that agent's state.
_Avoid_: Agent key, pane key

**Agent Page**:
An ordered group of up to six agents projected onto the Agent Slots. Agent Pages preserve Herdr's agent order.
_Avoid_: Bank, layer

**Selected Agent**:
The agent represented by the most recently pressed Agent Slot. Agent commands target this agent rather than whichever terminal happens to have operating-system focus.
_Avoid_: Focused terminal, active pane

**Command Key**:
One of six Deck keys assigned to an action rather than an agent. Configuration numbers Command Keys 1–6 independently of the MacroPad's physical key numbers 7–12.
_Avoid_: Shortcut slot, macro key

**Page Key**:
The Command Key that cycles Agent Pages and indicates whether an agent outside the current page needs attention.
_Avoid_: Overflow key, next key

**Key Alias**:
A user-configured single keyboard key selected by the Host and tapped by the Deck as USB HID, such as the right Command key for dictation.
_Avoid_: Key chord, macro, executable hook

**Device Protocol**:
The newline-delimited JSON messages exchanged between the Host and Deck over USB CDC data.
_Avoid_: Herdr protocol, Socket API

**Render Snapshot**:
The complete LED and OLED state sent by the Host to replace the Deck's current presentation.
_Avoid_: State delta, display event

**Device Bundle**:
The herdr-micro files installed on the Deck's CircuitPython filesystem.
_Avoid_: Firmware, runtime

**Runtime Image**:
The CircuitPython UF2 image installed on the Deck.
_Avoid_: Firmware, device bundle

**Send Ctrl-C**:
Inject the `ctrl+c` key chord into an agent's terminal.
_Avoid_: Interrupt, stop, kill
