import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getStoredToken } from '../../utils/apiClient';
import { getPostLoginPath, useOperatorShell } from '../../hooks/useOperatorShell';
import './Login.css';

export default function Login() {
  const { login, user, ready } = useAuth();
  const isOperatorShell = useOperatorShell();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (ready && user && getStoredToken()) {
    return <Navigate to={getPostLoginPath()} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err?.message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-title">领益机器人</div>
          <div className="login-brand-sub">
            {isOperatorShell ? 'RoboView 现场控制台' : 'RoboView 监控台'}
          </div>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label">
            用户名
            <input
              className="login-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="login-label">
            密码
            <input
              className="login-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </label>
          {error ? <div className="login-error">{error}</div> : null}
          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
