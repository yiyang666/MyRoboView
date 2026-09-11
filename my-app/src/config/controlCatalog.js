/*
 * 产品控制能力统一入口。
 *
 * 对齐 robotUrdfConfig.js：编译期按 REACT_APP_PRODUCT 选择一份产品配置，
 * 让按钮、卡片显隐和快捷键都从同一个数据源派生。
 */
import { CONTROL_CATALOG as LRS_X_CONTROL_CATALOG } from './lrs-x/controlCatalog';
import { CONTROL_CATALOG as LRD_W_CONTROL_CATALOG } from './lrd-w/controlCatalog';

const PRODUCT_CATALOGS = {
  'lrs-x': LRS_X_CONTROL_CATALOG,
  'lrd-w': LRD_W_CONTROL_CATALOG,
};

const product = (process.env.REACT_APP_PRODUCT || 'lrs-x').trim();
const selected = PRODUCT_CATALOGS[product];

if (!selected) {
  throw new Error(
    `[roboview] 未知控制产品 REACT_APP_PRODUCT="${product}"，可选: ${Object.keys(PRODUCT_CATALOGS).join(', ')}`
  );
}

/**
 * 把连续的快捷键提示压缩成人类可读摘要：
 * - 1,2,3,4 -> 1~4
 * - Alt+1,Alt+2 -> Alt+1~2
 * - 不连续则保留枚举：1、3、5
 */
function compactHotkeyHints(items = []) {
  const hints = items
    .map((item) => item?.hotkeyHint?.trim())
    .filter(Boolean);

  if (hints.length === 0) return '';
  if (hints.length === 1) return hints[0];

  const parsed = hints.map((hint) => {
    const match = hint.match(/^(?:(.+?)\+)?(\d+)$/);
    if (!match) return null;
    return {
      modifier: match[1] || '',
      number: Number(match[2]),
    };
  });

  if (parsed.some((item) => !item)) {
    return hints.join('、');
  }

  const modifier = parsed[0].modifier;
  const allSameModifier = parsed.every((item) => item.modifier === modifier);
  if (!allSameModifier) {
    return hints.join('、');
  }

  const numbers = parsed.map((item) => item.number);
  const isSequential = numbers.every((num, index) => index === 0 || num === numbers[index - 1] + 1);
  if (!isSequential) {
    return hints.join('、');
  }

  const prefix = modifier ? `${modifier}+` : '';
  return `${prefix}${numbers[0]}~${numbers[numbers.length - 1]}`;
}

function withWebModeSuffix(text) {
  return text ? `${text}（仅网页控制）` : '';
}

function buildStateHint(catalog) {
  const stateRange = compactHotkeyHints(catalog.states);
  const softEStopHint = catalog.softEStop?.hotkeyHint || '';
  const parts = [];

  if (stateRange) {
    parts.push(`切换状态：${stateRange}`);
  }
  if (softEStopHint) {
    parts.push(`软急停：${softEStopHint}`);
  }
  return withWebModeSuffix(parts.join('，'));
}

function buildSectionHotkeyHints(catalog) {
  const manualHints = catalog.sectionHotkeyHints || {};
  return {
    state: buildStateHint(catalog),
    mode: manualHints.mode || '',
    action: withWebModeSuffix(compactHotkeyHints(catalog.actions)),
    voice: withWebModeSuffix(compactHotkeyHints(catalog.voicePresets)),
    dance: manualHints.dance || '',
    script: manualHints.script || '',
  };
}

export const CONTROL_PRODUCT = product;
export const CONTROL_CATALOG = {
  ...selected,
  // 在统一入口生成摘要，避免每个产品单独手写 section 提示造成文案漂移
  sectionHotkeyHints: buildSectionHotkeyHints(selected),
};
