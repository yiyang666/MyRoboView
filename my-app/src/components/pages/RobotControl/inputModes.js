export const INPUT_MODES = {
  WEB: 'web',
  IOT: 'iot',
};

export const joySwitchesForMode = (mode) => {
  switch (mode) {
    case INPUT_MODES.IOT:
      return { iot_joy_switch: true, web_joy_switch: false };
    case INPUT_MODES.WEB:
      return { iot_joy_switch: false, web_joy_switch: true };
    default:
      return { iot_joy_switch: true, web_joy_switch: false };
  }
};

export const initialModeFromConfig = ({ iot_joy_switch, web_joy_switch }) => {
  if (iot_joy_switch) return INPUT_MODES.IOT;
  if (web_joy_switch) return INPUT_MODES.WEB;
  return INPUT_MODES.IOT;
};

export const isWebJoyActive = (mode) => mode === INPUT_MODES.WEB;
