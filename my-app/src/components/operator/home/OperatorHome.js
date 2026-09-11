import React from 'react';
import { useNavigate } from 'react-router-dom';
import OperatorHeader from '../OperatorHeader';
import { hasFeature } from '../../../config/productFeatures';
import './OperatorHome.css';

/**
 * 手机现场中台：登录后选择遥控或导航模式
 * 导航入口由产品能力表 mapNavigation 控制
 */
export default function OperatorHome({ robotStatus, inputMode }) {
  const navigate = useNavigate();
  const showNav = hasFeature('mapNavigation');

  return (
    <div className="operator-home">
      <OperatorHeader robotStatus={robotStatus} inputMode={inputMode} title="现场控制台" />
      <main className="operator-home__main">
        <p className="operator-home__hint">选择现场工作模式</p>
        <div className="operator-home__cards">
          <button
            type="button"
            className="operator-home__card operator-home__card--control"
            onClick={() => navigate('/operator/control')}
          >
            <span className="operator-home__card-kicker">CONTROL</span>
            <span className="operator-home__card-title">遥控模式</span>
            <span className="operator-home__card-desc">摇杆与网页遥控，适合现场手动操作</span>
          </button>
          {showNav ? (
            <button
              type="button"
              className="operator-home__card operator-home__card--nav"
              onClick={() => navigate('/operator/nav')}
            >
              <span className="operator-home__card-kicker">NAV</span>
              <span className="operator-home__card-title">导航模式</span>
              <span className="operator-home__card-desc">地图、建图与线路任务（现场精简版）</span>
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
