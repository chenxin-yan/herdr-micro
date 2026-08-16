import { dirname } from "node:path";

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

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));
const RegularCommandAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({ type: Schema.Literal("newAgent"), color: HexColor }),
  Schema.Struct({ type: Schema.Literal("closeTab"), color: HexColor }),
  Schema.Struct({
    type: Schema.Literal("sendKeys"),
    keys: Schema.NonEmptyArray(Schema.NonEmptyString),
    color: HexColor,
  }),
  Schema.Struct({
    type: Schema.Literal("keyAlias"),
    key: Schema.Literals(HID_KEYS),
    color: HexColor,
  }),
]);
const CommandAction = Schema.Union([
  RegularCommandAction,
  Schema.Struct({ type: Schema.Literal("layer"), color: HexColor }),
]);
const ConfigSchema = Schema.Struct({
  defaultAgentCommand: Schema.Array(Schema.String),
  encoderTimeoutSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  screensaverMinutes: Schema.Finite.check(Schema.isGreaterThan(0)),
  commandKeys: Schema.Struct({
    "1": CommandAction,
    "2": CommandAction,
    "3": CommandAction,
    "4": CommandAction,
    "5": CommandAction,
    "6": CommandAction,
  }),
  layerKeys: Schema.Struct({
    "1": RegularCommandAction,
    "2": RegularCommandAction,
    "3": RegularCommandAction,
    "4": RegularCommandAction,
    "5": RegularCommandAction,
    "6": RegularCommandAction,
  }),
  appearance: Schema.Struct({
    brightness: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    states: Schema.Struct({
      blocked: HexColor,
      done: HexColor,
      working: HexColor,
      idle: HexColor,
      unknown: HexColor,
    }),
  }),
});

export type Config = typeof ConfigSchema.Type;
export type CommandAction = typeof CommandAction.Type;
export type CommandKeys = Config["commandKeys"];

export const DEFAULT_CONFIG: Config = {
  defaultAgentCommand: ["pi"],
  encoderTimeoutSeconds: 4,
  screensaverMinutes: 10,
  commandKeys: {
    "1": { type: "sendKeys", keys: ["ctrl+c"], color: "#ff8800" },
    "2": { type: "sendKeys", keys: ["esc"], color: "#ff8800" },
    // The held Layer key keeps this cyan binding color while the other LEDs show layerKeys.
    "3": { type: "layer", color: "#00ffff" },
    "4": { type: "keyAlias", key: "RIGHT_GUI", color: "#ffff00" },
    "5": { type: "sendKeys", keys: ["enter"], color: "#ff8800" },
    "6": { type: "sendKeys", keys: ["alt+enter"], color: "#ff8800" },
  },
  layerKeys: {
    "1": { type: "newAgent", color: "#00ffff" },
    "2": { type: "closeTab", color: "#ff8800" },
    "3": { type: "none" },
    "4": { type: "sendKeys", keys: ["down"], color: "#ffff00" },
    "5": { type: "sendKeys", keys: ["up"], color: "#ffff00" },
    // Blocked by herdr 0.8.0: send_keys downgrades shift+tab to plain Tab
    // (herdrdev/herdr#1561, fixed on master, pending release).
    "6": { type: "sendKeys", keys: ["shift+tab"], color: "#ff8800" },
  },
  appearance: {
    brightness: 0.2,
    states: {
      blocked: "#ff0000",
      done: "#00ff00",
      working: "#0000ff",
      idle: "#ffffff",
      unknown: "#8000ff",
    },
  },
};

class ConfigError extends Data.TaggedError("ConfigError")<{
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

export const configFileExists = Effect.fn("configFileExists")(function* (
  path: string,
): Effect.fn.Return<boolean, ConfigError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .exists(path)
    .pipe(
      Effect.mapError(
        (cause) =>
          new ConfigError({ message: `Cannot inspect configuration at ${path}: ${String(cause)}` }),
      ),
    );
});

export const initializeConfig = Effect.fn("initializeConfig")(function* (
  path: string,
): Effect.fn.Return<void, ConfigError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(dirname(path), { recursive: true })
    .pipe(
      Effect.mapError(
        (cause) =>
          new ConfigError({ message: `Cannot create configuration directory: ${String(cause)}` }),
      ),
    );
  yield* fs
    .writeFileString(path, `${JSON.stringify(DEFAULT_CONFIG, undefined, 2)}\n`, { flag: "wx" })
    .pipe(
      Effect.catchReason(
        "PlatformError",
        "AlreadyExists",
        () =>
          new ConfigError({
            message: `Configuration already exists at ${path}; refusing to overwrite it`,
          }),
      ),
      Effect.catchTag("PlatformError", (cause) =>
        Effect.fail(
          new ConfigError({ message: `Cannot write configuration at ${path}: ${String(cause)}` }),
        ),
      ),
    );
});
