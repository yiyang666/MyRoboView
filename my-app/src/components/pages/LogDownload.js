import React, { useState, useEffect } from 'react';
import './Page.css';
import { apiFetch } from '../../utils/apiClient';
import { useAuth } from '../../context/AuthContext';

const LogDownload = () => {
  const { isDeveloper } = useAuth();
  const [fileType, setFileType] = useState('log'); // 'log' 或 'bag'
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rotatingBag, setRotatingBag] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiles, setTotalFiles] = useState(0);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [downloading, setDownloading] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [previewing, setPreviewing] = useState({});

  const pageSize = 10; // 与后端保持一致，后端每次计算需要返回的页面数量

  const clearBusyState = (setter, filename) => {
    setter((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
  };

  // 拉取文件内容（带进度），供下载 / 预览复用
  const fetchFileChunks = async (filename, onProgress) => {
    const response = await apiFetch(
      `/api/v1/files/download?type=${fileType}&filename=${encodeURIComponent(filename)}`
    );
    if (!response.ok) {
      throw new Error('请求失败');
    }

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      if (total > 0 && onProgress) {
        onProgress(Math.round((receivedLength / total) * 100));
      }
    }
    return chunks;
  };

  // 加载文件列表
  const loadFiles = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: fileType,
        page: currentPage.toString(),
        pageSize: pageSize.toString(),
      });
      
      if (dateStart) params.append('date_start', dateStart);
      if (dateEnd) params.append('date_end', dateEnd);

      const response = await apiFetch(`/api/v1/files/list?${params}`);
      if (!response.ok) {
        throw new Error('Failed to load files');
      }

      const data = await response.json();
      if (data.success) {
        setFiles(data.files || []);
        setTotalPages(data.totalPages || 1);
        setTotalFiles(data.total || 0);
      } else {
        throw new Error(data.error || 'Failed to load files');
      }
    } catch (error) {
      console.error('Error loading files:', error);
      alert('加载文件列表失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 当文件类型、页码或日期范围改变时重新加载
  useEffect(() => {
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileType, currentPage, dateStart, dateEnd]);

  // 刷新 Bag：重启 diagnostics 使当前录制文件可下载，再刷新列表
  const rotateBagRecording = async () => {
    if (rotatingBag) return;
    const confirmed = window.confirm(
      '将重启 diagnostics，把正在录制的 Bag 写成可下载的 .mcap，并开始新的录制。\n\n' +
        '风险：期间 Bag/Log 录制会短暂中断，可能丢失数秒数据。是否继续？'
    );
    if (!confirmed) return;

    setRotatingBag(true);
    try {
      const response = await apiFetch('/api/v1/files/rotate_bag', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || `请求失败 (${response.status})`);
      }
      await loadFiles();
    } catch (error) {
      console.error('Error rotating bag:', error);
      alert('刷新失败: ' + error.message);
    } finally {
      setRotatingBag(false);
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // 下载文件（带进度显示）；录制中的 bag 不可下载
  const downloadFile = async (filename) => {
    if (downloading[filename] || previewing[filename]) return;
    if (fileType === 'bag' && filename.endsWith('.mcap.active')) {
      alert('正在录制的 Bag 不可下载，请先点击「刷新」落盘后再下载');
      return;
    }

    setDownloading((prev) => ({ ...prev, [filename]: true }));
    setDownloadProgress((prev) => ({ ...prev, [filename]: 0 }));

    try {
      const chunks = await fetchFileChunks(filename, (progress) => {
        setDownloadProgress((prev) => ({ ...prev, [filename]: progress }));
      });

      const blob = new Blob(chunks);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setDownloadProgress((prev) => ({ ...prev, [filename]: 100 }));
      setTimeout(() => {
        clearBusyState(setDownloading, filename);
        clearBusyState(setDownloadProgress, filename);
      }, 500);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('下载失败: ' + error.message);
      clearBusyState(setDownloading, filename);
      clearBusyState(setDownloadProgress, filename);
    }
  };

  // 预览 log：拉全文后以 blob 新标签页打开（浏览器原生文本预览）
  const previewLogFile = async (file) => {
    if (fileType !== 'log') return;
    if (downloading[file.name] || previewing[file.name]) return;

    // 在用户点击同步路径中先开空白页，避免弹窗拦截
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      alert('浏览器拦截了弹窗，请允许本站弹窗后重试');
      return;
    }
    try {
      previewWindow.document.title = `加载中… ${file.name}`;
      previewWindow.document.body.innerText = `正在加载 ${file.name} …`;
    } catch (_) {
      // 跨域/受限时忽略标题写入
    }

    setPreviewing((prev) => ({ ...prev, [file.name]: true }));
    setDownloadProgress((prev) => ({ ...prev, [file.name]: 0 }));

    try {
      const chunks = await fetchFileChunks(file.name, (progress) => {
        setDownloadProgress((prev) => ({ ...prev, [file.name]: progress }));
      });
      const blob = new Blob(chunks, { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      previewWindow.location.replace(blobUrl);
      // 延迟释放，确保新标签页已完成加载
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      setDownloadProgress((prev) => ({ ...prev, [file.name]: 100 }));
      setTimeout(() => {
        clearBusyState(setPreviewing, file.name);
        clearBusyState(setDownloadProgress, file.name);
      }, 500);
    } catch (error) {
      console.error('Error previewing file:', error);
      try {
        previewWindow.close();
      } catch (_) {
        /* ignore */
      }
      alert('预览失败: ' + error.message);
      clearBusyState(setPreviewing, file.name);
      clearBusyState(setDownloadProgress, file.name);
    }
  };

  // 重置日期筛选
  const resetDateFilter = () => {
    setDateStart('');
    setDateEnd('');
    setCurrentPage(1);
  };

  return (
    <div className="page-container">
      <h2 className="page-title" style={{marginBottom: '10px'}}>日志下载</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
        {/* 操作栏合并一行 */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 文件类型 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ color: '#b0b0b0', fontSize: '18px' }}>文件类型：</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input
                type="radio"
                value="log"
                checked={fileType === 'log'}
                onChange={(e) => {
                  setFileType(e.target.value);
                  setCurrentPage(1);
                }}
              />
              <span>Log 文件</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input
                type="radio"
                value="bag"
                checked={fileType === 'bag'}
                onChange={(e) => {
                  setFileType(e.target.value);
                  setCurrentPage(1);
                }}
              />
              <span>Bag 文件</span>
            </label>
          </div>
          {/* 日期筛选 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{ color: '#b0b0b0', fontSize: '18px' }}>日期范围：</label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => {
                setDateStart(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: '5px 10px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                background: 'rgba(110, 110, 110, 0.5)',
                color: '#ffffff',
                fontSize: '14px'
              }}
            />
            <span style={{ color: '#b0b0b0' }}>至</span>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => {
                setDateEnd(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: '5px 10px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                background: 'rgba(110, 110, 110, 0.5)',
                color: '#ffffff',
                fontSize: '14px'
              }}
            />
            {(dateStart || dateEnd) && (
              <button
                onClick={resetDateFilter}
                style={{
                  padding: '5px 15px',
                  border: 'none',
                  borderRadius: '4px',
                  background: '#4a5568',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                清除筛选
              </button>
            )}
          </div>
          {/* Bag 刷新：developer 及以上可见；风险仅在确认框说明 */}
          {fileType === 'bag' && isDeveloper && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={rotateBagRecording}
                disabled={rotatingBag || loading}
                style={{
                  padding: '6px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  background: rotatingBag || loading ? '#4a5568' : '#d97706',
                  color: '#ffffff',
                  cursor: rotatingBag || loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  opacity: rotatingBag || loading ? 0.6 : 1,
                }}
              >
                {rotatingBag ? '刷新中...' : '刷新'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 文件列表 */}
      <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>加载中...</div>
        ) : files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>暂无文件</div>
        ) : (
          <>
            <div style={{ marginBottom: '1px', color: '#b0b0b0', fontSize: '15px' }}>
              共 {totalFiles} 个文件，第 {currentPage} / {totalPages} 页
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.2)' }}>
                  <th style={{ padding: '10px', textAlign: 'left', color: '#60a5fa', fontWeight: '600' }}>文件名</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#60a5fa', fontWeight: '600' }}>大小</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#60a5fa', fontWeight: '600' }}>修改时间</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#60a5fa', fontWeight: '600' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <td style={{ padding: '10px', color: '#ffffff' }}>
                      {file.name}
                      {file.recording ? (
                        <span
                          title="正在录制"
                          style={{
                            marginLeft: '8px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            background: 'rgba(245, 158, 11, 0.25)',
                            color: '#f59e0b',
                            verticalAlign: 'middle',
                          }}
                        >
                          录制中
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center', color: '#b0b0b0' }}>{formatFileSize(file.size)}</td>
                    <td style={{ padding: '10px', textAlign: 'center', color: '#b0b0b0' }}>{file.modified}</td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      {(downloading[file.name] || previewing[file.name]) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                          <div style={{ width: '100px', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${downloadProgress[file.name] || 0}%`,
                                height: '100%',
                                background: '#3b82f6',
                                transition: 'width 0.3s ease'
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '12px', color: '#b0b0b0' }}>
                            {previewing[file.name] ? '预览中 ' : ''}
                            {downloadProgress[file.name] || 0}%
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {fileType === 'log' && (
                            <button
                              type="button"
                              onClick={() => previewLogFile(file)}
                              style={{
                                padding: '5px 15px',
                                border: 'none',
                                borderRadius: '4px',
                                background: '#4a5568',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '600'
                              }}
                            >
                              预览
                            </button>
                          )}
                          {/* bag 录制中不可下载；log active 仍可下 */}
                          {!(fileType === 'bag' && file.recording) ? (
                            <button
                              type="button"
                              onClick={() => downloadFile(file.name)}
                              style={{
                                padding: '5px 15px',
                                border: 'none',
                                borderRadius: '4px',
                                background: '#3b82f6',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '600'
                              }}
                            >
                              下载
                            </button>
                          ) : (
                            <span style={{ fontSize: '13px', color: '#888' }}>
                              录制中不可下载
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            style={{
              padding: '8px 15px',
              border: 'none',
              borderRadius: '4px',
              background: currentPage === 1 ? '#4a5568' : '#3b82f6',
              color: '#ffffff',
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: currentPage === 1 ? 0.5 : 1
            }}
          >
            上一页
          </button>
          <span style={{ color: '#ffffff', fontSize: '14px' }}>
            第 {currentPage} / {totalPages} 页
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: '8px 15px',
              border: 'none',
              borderRadius: '4px',
              background: currentPage === totalPages ? '#4a5568' : '#3b82f6',
              color: '#ffffff',
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: currentPage === totalPages ? 0.5 : 1
            }}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
};

export default LogDownload;
