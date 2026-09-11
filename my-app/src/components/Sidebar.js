/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-28 13:44:23
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-09-10 16:26:25
 * @FilePath: /build_all/src/roboview/my-app/src/components/Sidebar.js
 * @Description: 桌面侧栏；菜单项可通过 feature 按产品能力表裁剪
 */
import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasFeature } from '../config/productFeatures';
import './Sidebar.css';

/** 全量菜单；带 feature 的项仅在产品开启对应能力时显示 */
const ALL_MENU_ITEMS = [
  { id: 'motor', label: '电机状态', icon: '⚙️', path: '/' },
  { id: 'control', label: '机器人控制', icon: '🎮', path: '/control' },
  { id: 'joints', label: '关节控制', icon: '🦾', path: '/joints' },
  {
    id: 'navigation',
    label: '地图导航',
    icon: '🗺️',
    path: '/navigation',
    feature: 'mapNavigation',
  },
  { id: 'sensor', label: '传感器状态', icon: '📊', path: '/sensor' },
  { id: 'monitor', label: '资源监控', icon: '📈', path: '/monitor' },
  { id: 'logs', label: '日志查看', icon: '📝', path: '/logs' },
  { id: 'download', label: '日志下载', icon: '⬇️', path: '/download' },
];

const Sidebar = ({ selectedMenu, onMenuSelect }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const roleLabel = (() => {
    if (!user?.role) return '';
    if (user.role === 'admin') return '管理员';
    if (user.role === 'developer') return '开发者';
    return '普通用户';
  })();

  const menuItems = useMemo(
    () => ALL_MENU_ITEMS.filter((item) => !item.feature || hasFeature(item.feature)),
    []
  );

  const handleMenuClick = (item) => {
    onMenuSelect(item.id);
    navigate(item.path);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>🤖 RoboView</h2>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`menu-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => handleMenuClick(item)}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div
          className="sidebar-user"
          style={{
            fontSize: '25px',
            color: '#94a3b8',
            marginBottom: '8px',
            textAlign: 'center',
          }}
        >
          {user?.username ? (
            <>
              <div>👤 账户  : {user.username}</div>
              <div>🛡️ 身份  :  {roleLabel}</div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={logout}
          className="menu-item"
          style={{
            width: '100%',
            marginBottom: '8px',
            fontSize: '20px',
            textAlign: 'center',
          }}
        >
          <span className="menu-label">🚪退出登录</span>
        </button>
        <div className="version-info" style={{ fontSize: '25px' }}>
          V1.2.1
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
