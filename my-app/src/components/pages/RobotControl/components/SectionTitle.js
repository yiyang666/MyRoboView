import React from 'react';

const SectionTitle = ({ title, hotkeyHint }) => (
  <h3 className="control-section-title">
    {title}
    {hotkeyHint ? (
      <span className="section-hotkey-hint">{hotkeyHint}</span>
    ) : null}
  </h3>
);

export default SectionTitle;
