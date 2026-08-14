import { Data, Effect, FileSystem, Result, Schema, SchemaIssue } from "effect";

// adafruit_hid Keycode names accepted by the device side.
const DIGIT_WORDS = [
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "ZERO",
];
const HID_KEYS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ...DIGIT_WORDS,
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ...DIGIT_WORDS.map((word) => `KEYPAD_${word}`),
  ...`ENTER RETURN ESCAPE BACKSPACE TAB SPACEBAR SPACE MINUS EQUALS LEFT_BRACKET
     RIGHT_BRACKET BACKSLASH POUND SEMICOLON QUOTE GRAVE_ACCENT COMMA PERIOD
     FORWARD_SLASH CAPS_LOCK PRINT_SCREEN SCROLL_LOCK PAUSE INSERT HOME PAGE_UP
     DELETE END PAGE_DOWN RIGHT_ARROW LEFT_ARROW DOWN_ARROW UP_ARROW
     KEYPAD_NUMLOCK KEYPAD_FORWARD_SLASH KEYPAD_ASTERISK KEYPAD_MINUS KEYPAD_PLUS
     KEYPAD_ENTER KEYPAD_PERIOD KEYPAD_BACKSLASH KEYPAD_EQUALS APPLICATION POWER
     LEFT_CONTROL CONTROL LEFT_SHIFT SHIFT LEFT_ALT ALT OPTION LEFT_GUI GUI
     WINDOWS COMMAND RIGHT_CONTROL RIGHT_SHIFT RIGHT_ALT RIGHT_GUI`
    .trim()
    .split(/\s+/),
];

const CommandAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({ type: Schema.Literal("newAgent") }),
  Schema.Struct({ type: Schema.Literal("nextPage") }),
  Schema.Struct({ type: Schema.Literal("enter") }),
  Schema.Struct({ type: Schema.Literal("sendCtrlC") }),
  Schema.Struct({ type: Schema.Literal("keyAlias"), key: Schema.Literals(HID_KEYS) }),
]);
const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));
// Every field is optional in a provided file; leaf defaults live here in
// the schema, containers default to {} so the leaf defaults cascade.
const color = (fallback: string) =>
  HexColor.pipe(Schema.withDecodingDefaultKey(Effect.succeed(fallback)));
const DefaultedAction = CommandAction.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({ type: "none" as const })),
);
const ConfigSchema = Schema.Struct({
  defaultAgentCommand: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(["pi"])),
  ),
  commandKeys: Schema.Struct({
    "1": DefaultedAction,
    "2": DefaultedAction,
    "3": DefaultedAction,
    "4": DefaultedAction,
    "5": DefaultedAction,
    "6": DefaultedAction,
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  appearance: Schema.Struct({
    brightness: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(0.2)),
    ),
    states: Schema.Struct({
      blocked: color("#ff0000"),
      done: color("#00ff00"),
      working: color("#0000ff"),
      idle: color("#ffffff"),
      unknown: color("#8000ff"),
    }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
});

export type Config = typeof ConfigSchema.Type;
export type CommandAction = typeof CommandAction.Type;
export type CommandKeys = Config["commandKeys"];

export const DEFAULT_CONFIG: Config = {
  ...Schema.decodeUnknownSync(ConfigSchema)({}),
  // Missing-file default: the rich built-in bindings. Keys omitted from a
  // provided commandKeys still default to none per spec.
  commandKeys: {
    "1": { type: "newAgent" },
    "2": { type: "nextPage" },
    "3": { type: "keyAlias", key: "RIGHT_GUI" },
    "4": { type: "enter" },
    "5": { type: "sendCtrlC" },
    "6": { type: "none" },
  },
};

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

const formatter = SchemaIssue.makeFormatterDefault();
const ConfigFromJson = Schema.fromJsonString(ConfigSchema);

function decodeConfig(text: string, path: string): Effect.Effect<Config, ConfigError> {
  const decoded = Schema.decodeUnknownResult(ConfigFromJson)(text, {
    onExcessProperty: "error",
    reportInput: true,
  });
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new ConfigError({
        message: `Invalid configuration at ${path}: ${formatter(decoded.failure.issue)}`,
      }),
    );
  }
  return Effect.succeed(decoded.success);
}

export const loadConfig = Effect.fn("loadConfig")(function* (
  path: string,
): Effect.fn.Return<Config, ConfigError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(path).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
    Effect.mapError(
      (cause) =>
        new ConfigError({ message: `Cannot read configuration at ${path}: ${String(cause)}` }),
    ),
  );
  if (text === undefined) return DEFAULT_CONFIG;

  return yield* decodeConfig(text, path);
});
