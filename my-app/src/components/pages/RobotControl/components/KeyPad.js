import React from 'react';

const KeyBadge = ({ label, active, dimmed }) => (
  <span
    className={`key-badge ${active ? 'key-badge--active' : ''} ${dimmed ? 'key-badge--dimmed' : ''}`}
  >
    {label}
  </span>
);

export const WasdKeyPad = ({ moveKeyActive, keyboardMode }) => (
  <div className="wasd-pad" title="移动：W/S 前后，A/D 左右">
    <span className="key-pad-label">移动</span>
    <div className="wasd-pad__grid">
      <div className="wasd-pad__row wasd-pad__row--top">
        <KeyBadge label="W" active={moveKeyActive('KeyW')} dimmed={!keyboardMode} />
      </div>
      <div className="wasd-pad__row">
        <KeyBadge label="A" active={moveKeyActive('KeyA')} dimmed={!keyboardMode} />
        <KeyBadge label="S" active={moveKeyActive('KeyS')} dimmed={!keyboardMode} />
        <KeyBadge label="D" active={moveKeyActive('KeyD')} dimmed={!keyboardMode} />
      </div>
    </div>
  </div>
);

export const ArrowKeyPad = ({ turnKeyActive, keyboardMode }) => (
  <div className="arrow-pad" title="转向：← →">
    <span className="key-pad-label">转向</span>
    <div className="arrow-pad__row">
      <KeyBadge label="←" active={turnKeyActive('ArrowLeft')} dimmed={!keyboardMode} />
      <KeyBadge label="→" active={turnKeyActive('ArrowRight')} dimmed={!keyboardMode} />
    </div>
  </div>
);
