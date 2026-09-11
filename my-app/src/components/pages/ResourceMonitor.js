import React, { useState, useEffect, useRef } from 'react';
import './Page.css';

// 进程名 → 稳定色相（哈希 HSL）；同名始终同色，数量不限
function colorForProcess(name) {
  if (!name || name === 'all') return '#ffffff';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

const ResourceMonitor = ({ sendMessage, addMessageHandler, connected }) => {
  const [selectedMetric, setSelectedMetric] = useState('cpu'); // 'cpu' 或 'memory'
  const [processes, setProcesses] = useState({}); // 当前进程数据
  const [chartData, setChartData] = useState([]); // 折线图数据
  const [startTime, setStartTime] = useState(null); // 开始记录时间
  const [splitPosition, setSplitPosition] = useState(60); // 分割位置百分比（默认60%）
  const [isResizing, setIsResizing] = useState(false);
  const [chartSize, setChartSize] = useState({ width: 600, height: 400 }); // 图表尺寸
  const [refreshInterval, setRefreshInterval] = useState(1); // 刷新间隔（秒），默认1秒
  const lastReceiveTimeRef = useRef(null); // 上次接收数据的时间
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const chartWrapperRef = useRef(null);

  // 每个进程最多保留的数据点数
  const MAX_DATA_WINDOWS = 1200;

  // 页面订阅：WS 连通且本页挂载时即订阅 monitor
  useEffect(() => {
    if (connected && sendMessage) {
      // 订阅监控页面
      sendMessage({
        type: 'subscribe',
        data: { page: 'monitor' }
      });

      // 重置数据，开始新的记录
      setChartData([]);
      setStartTime(Date.now());
      lastReceiveTimeRef.current = null;

      return () => {
        // 取消订阅
        sendMessage({
          type: 'unsubscribe',
          data: { page: 'monitor' }
        });
        // 切换页面时重置数据
        setChartData([]);
        setStartTime(null);
      };
    }
  }, [connected, sendMessage]);

  // 接收 WebSocket 消息
  useEffect(() => {
    if (!addMessageHandler) return;

    const handleMessage = (data) => {
      if (data.type === 'monitor_data' && data.data.processes) {
        const processesList = data.data.processes;

        // 根据刷新间隔决定是否接收这个数据点
        const currentTime = Date.now();
        if (lastReceiveTimeRef.current !== null) {
          const timeSinceLastReceive = (currentTime - lastReceiveTimeRef.current) / 1000; // 秒
          if (timeSinceLastReceive < refreshInterval) {
            // 还没到刷新间隔，忽略这个数据点
            return;
          }
        }
        lastReceiveTimeRef.current = currentTime;

        // 更新当前进程数据（使用新的字段名 process_name）
        const newProcesses = {};
        processesList.forEach(proc => {
          const procName = proc.process_name;
          newProcesses[procName] = proc;
        });

        // 计算 "all" 进程的聚合数据
        let totalCpu = 0;
        let totalMem = 0;  // MB
        let totalRssAnon = 0;
        let totalRssFile = 0;
        let totalRssShmem = 0;
        let totalFd = 0;

        processesList.forEach(proc => {
          totalCpu += proc.cpu_usage || 0;
          totalMem += proc.mem_usage || 0;  // MB
          totalRssAnon += proc.rss_anon || 0;
          totalRssFile += proc.rss_file || 0;
          totalRssShmem += proc.rss_shmem || 0;
          totalFd += proc.fd || 0;
        });

        newProcesses['all'] = {
          process_name: 'all',
          cpu_usage: totalCpu,
          mem_usage: totalMem,  // MB
          rss_anon: totalRssAnon,
          rss_file: totalRssFile,
          rss_shmem: totalRssShmem,
          fd: totalFd,
          pid: 0
        };

        setProcesses(newProcesses);

        // 更新折线图数据
        if (startTime !== null) {
          // 使用实际接收时间计算elapsed，而不是使用后端timestamp
          // 这样可以确保时间戳的连续性，与刷新间隔一致
          // 因为刷新间隔已经过滤了数据点，所以这里使用接收时间更准确
          const currentReceiveTime = Date.now();
          const elapsed = (currentReceiveTime - startTime) / 1000; // 秒

          setChartData(prev => {
            const newData = [...prev];

            // 为每个进程添加数据点（排除all进程）
            Object.keys(newProcesses).forEach(procName => {
              // 跳过all进程，不在折线图中显示
              if (procName === 'all') return;

              const proc = newProcesses[procName];
              // CPU使用率是百分比，内存使用是MB
              const value = selectedMetric === 'cpu' ? proc.cpu_usage : proc.mem_usage;

              // 查找或创建该进程的数据数组
              let procData = newData.find(d => d.process === procName);
              if (!procData) {
                procData = { process: procName, data: [] };
                newData.push(procData);
              }

              // 添加新数据点
              procData.data.push({ time: elapsed, value: value });

              // 限制数据点数量：每个进程最多保留MAX_DATA_WINDOWS条数据
              // 当超过MAX_DATA_WINDOWS条时，移除最早的数据，保留最近MAX_DATA_WINDOWS条
              if (procData.data.length > MAX_DATA_WINDOWS) {
                procData.data = procData.data.slice(-MAX_DATA_WINDOWS);
              }
            });

            return newData;
          });
        }
      }
    };

    const removeHandler = addMessageHandler(handleMessage);
    return removeHandler;
  }, [addMessageHandler, startTime, selectedMetric, refreshInterval]);

  // WebSocket 断开时重置数据（不依赖机器人业务在线状态）
  useEffect(() => {
    if (!connected) {
      setProcesses({});
      setChartData([]);
      setStartTime(null);
      lastReceiveTimeRef.current = null;
    }
  }, [connected]);

  // 监听图表容器大小变化
  useEffect(() => {
    if (!chartWrapperRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setChartSize({ width, height });
        }
      }
    });

    resizeObserver.observe(chartWrapperRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 绘制折线图
  useEffect(() => {
    if (!svgRef.current || chartData.length === 0) return;

    const svg = svgRef.current;
    const width = chartSize.width || 800;
    const height = chartSize.height || 400;

    // 设置SVG的实际尺寸
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const padding = { top: 20, right: 20, bottom: 40, left: 65 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // 清空 SVG
    svg.innerHTML = '';

    // ========== 简化逻辑：直接使用数据点的时间范围 ==========
    // 1. 数据存储时已经保留了最新的MAX_DATA_WINDOWS条数据
    // 2. 直接使用这些数据的时间范围来设置横轴
    // 3. 绘制所有数据点即可

    let minValue = Infinity;
    let maxValue = -Infinity;
    let minTime = Infinity; //
    let maxTimeDisplay = 0;

    // 遍历所有进程，找到时间范围和值的范围
    chartData.forEach(procData => {
      if (procData.process === 'all') return; // 排除all进程

      if (procData.data.length > 0) {
        const times = procData.data.map(d => d.time);
        const values = procData.data.map(d => d.value);
        minTime = Math.min(minTime, ...times);
        maxTimeDisplay = Math.max(maxTimeDisplay, ...times);
        minValue = Math.min(minValue, ...values);
        maxValue = Math.max(maxValue, ...values);
      }
    });

    if (minValue === Infinity || minTime === Infinity) return;

    // 添加一些边距
    const valueRange = maxValue - minValue;
    const valuePadding = valueRange * 0.1;
    const adjustedMinValue = Math.max(0, minValue - valuePadding);
    const adjustedMaxValue = maxValue + valuePadding;

    // 坐标转换函数
    // 横轴：从minTime到maxTimeDisplay（滑动窗口的时间范围）
    const timeRange = maxTimeDisplay - minTime;
    const xScale = (time) => {
      if (timeRange === 0) return padding.left;
      return padding.left + ((time - minTime) / timeRange) * chartWidth;
    };
    const yScale = (value) => padding.top + chartHeight - ((value - adjustedMinValue) / (adjustedMaxValue - adjustedMinValue)) * chartHeight;

    // 绘制网格线
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridGroup.setAttribute('class', 'grid');

    // 水平网格线
    for (let i = 0; i <= 5; i++) {
      const value = adjustedMinValue + (adjustedMaxValue - adjustedMinValue) * (i / 5);
      const y = yScale(value);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.1)');
      line.setAttribute('stroke-width', '1');
      gridGroup.appendChild(line);

      // Y轴标签
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', padding.left - 10);
      text.setAttribute('y', y + 5);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('fill', '#b0b0b0');
      text.setAttribute('font-size', '15');
      text.textContent = value.toFixed(1);
      gridGroup.appendChild(text);
    }

    // 垂直网格线（基于显示时间范围）
    for (let i = 0; i <= 10; i++) {
      const time = minTime + (timeRange / 10) * i;
      const x = xScale(time);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', padding.top);
      line.setAttribute('x2', x);
      line.setAttribute('y2', height - padding.bottom);
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.1)');
      line.setAttribute('stroke-width', '1');
      gridGroup.appendChild(line);

      // X轴标签（显示实际时间）
      if (i % 2 === 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', height - padding.bottom + 20);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#b0b0b0');
        text.setAttribute('font-size', '15');
        text.textContent = `${time.toFixed(0)}s`;
        gridGroup.appendChild(text);
      }
    }

    svg.appendChild(gridGroup);

    // 绘制折线
    // 每个进程的数据已经限制为最多MAX_DATA_WINDOWS条
    // 横轴显示范围是[minTime, maxTimeDisplay]
    // 由于数据已经限制为MAX_DATA_WINDOWS条，且横轴范围就是这些数据的时间范围，所以直接绘制所有数据点
    chartData.forEach(procData => {
      if (procData.data.length === 0) return;
      if (procData.process === 'all') return; // 不显示all进程的折线

      // 由于数据已经限制为MAX_DATA_WINDOWS条，且横轴范围就是这些数据的时间范围
      // 所以直接绘制所有数据点，不需要过滤
      const color = colorForProcess(procData.process);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

      let pathData = '';
      procData.data.forEach((point, index) => {
        const x = xScale(point.time);
        const y = yScale(point.value);
        if (index === 0) {
          pathData += `M ${x} ${y}`;
        } else {
          pathData += ` L ${x} ${y}`;
        }
      });

      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('class', `line-${procData.process}`);
      svg.appendChild(path);
    });

    // 绘制数据点（只显示最后一个数据点）
    chartData.forEach(procData => {
      if (procData.data.length === 0) return;
      if (procData.process === 'all') return; // 不显示all进程的数据点

      // 由于数据已经限制为MAX_DATA_WINDOWS条，且横轴范围就是这些数据的时间范围
      // 所以直接取最后一个数据点即可
      const color = colorForProcess(procData.process);
      const lastPoint = procData.data[procData.data.length - 1];
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', xScale(lastPoint.time));
      circle.setAttribute('cy', yScale(lastPoint.value));
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', color);
      svg.appendChild(circle);
    });

    // 添加Y轴标签
    const yAxisLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yAxisLabel.setAttribute('x', padding.left - 30);
    yAxisLabel.setAttribute('y', height / 2-20);
    yAxisLabel.setAttribute('text-anchor', 'middle');
    yAxisLabel.setAttribute('fill', '#ffffff');
    yAxisLabel.setAttribute('font-size', '14');
    yAxisLabel.setAttribute('transform', `rotate(-90 ${padding.left - 30} ${height / 2})`);
    yAxisLabel.textContent = selectedMetric === 'cpu' ? 'CPU使用率 (%)' : '内存使用 (MB)';
    svg.appendChild(yAxisLabel);

    // 添加X轴标签
    const xAxisLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xAxisLabel.setAttribute('x', width / 2);
    xAxisLabel.setAttribute('y', height - 5);
    xAxisLabel.setAttribute('text-anchor', 'middle');
    xAxisLabel.setAttribute('fill', '#ffffff');
    xAxisLabel.setAttribute('font-size', '14');
    xAxisLabel.textContent = '时间 (秒)';
    svg.appendChild(xAxisLabel);

  }, [chartData, selectedMetric, chartSize, refreshInterval]);

  // 预留：后续如需在表格中显示更友好的单位，可在此补充 format 函数

  // 获取所有进程列表（包括 all）
  const allProcesses = Object.keys(processes).length > 0
    ? ['all', ...Object.keys(processes).filter(p => p !== 'all')]
    : [];

  // 处理分割条拖拽
  const handleMouseDown = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100;
      // 限制在20%到80%之间
      setSplitPosition(Math.max(20, Math.min(80, newPosition)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing]);

  return (
    <div className="page-container">
      <h2 className="page-title">资源监控</h2>

      <div className="monitor-layout" ref={containerRef}>
        {/* 左侧：折线图 */}
        <div className="monitor-chart-container" style={{ width: `${splitPosition}%` }}>
          <div className="chart-header">
            <h3>实时监控图表</h3>
            <div className="chart-controls">
              <label>
                <input
                  type="radio"
                  value="cpu"
                  checked={selectedMetric === 'cpu'}
                  onChange={(e) => {
                    setSelectedMetric(e.target.value);
                    setChartData([]); // 切换指标时重置图表
                    setStartTime(Date.now());
                    lastReceiveTimeRef.current = null;
                  }}
                />
                CPU使用率
              </label>
              <label>
                <input
                  type="radio"
                  value="memory"
                  checked={selectedMetric === 'memory'}
                  onChange={(e) => {
                    setSelectedMetric(e.target.value);
                    setChartData([]); // 切换指标时重置图表
                    setStartTime(Date.now());
                    lastReceiveTimeRef.current = null;
                  }}
                />
                内存使用率
              </label>
              <label style={{ marginLeft: '20px' }}>
                刷新间隔:
                <select
                  value={refreshInterval}
                  onChange={(e) => {
                    const newInterval = parseInt(e.target.value);
                    setRefreshInterval(newInterval);
                    lastReceiveTimeRef.current = null; // 重置接收时间，立即接收下一个数据
                  }}
                  style={{
                    marginLeft: '8px',
                    padding: '4px 8px',
                    backgroundColor: '#2d2d44',
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  <option value={1}>x1 (1秒)</option>
                  <option value={2}>x2 (2秒)</option>
                  <option value={3}>x3 (3秒)</option>
                  <option value={5}>x5 (5秒)</option>
                  <option value={10}>x10 (10秒)</option>
                  <option value={30}>x30 (30秒)</option>
                </select>
              </label>
            </div>
          </div>

          <div className="chart-legend">
            {allProcesses.filter(procName => procName !== 'all').map(procName => (
              <div key={procName} className="legend-item">
                <span
                  className="legend-color"
                  style={{ backgroundColor: colorForProcess(procName) }}
                />
                <span>{procName}</span>
              </div>
            ))}
          </div>

          <div className="chart-wrapper" ref={chartWrapperRef}>
            <svg
              ref={svgRef}
              className="monitor-chart"
              preserveAspectRatio="none"
            />
          </div>

          {chartData.length === 0 && (
            <div className="chart-empty" style={{left:'30%',top:'50%'}}>
              等待数据中...（需要连接机器人并等待数据更新）
            </div>
          )}
        </div>

        {/* 可调整大小的分割条 */}
        <div
          className="monitor-splitter"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'col-resize' }}
        />

        {/* 右侧：统计表格 */}
        <div className="monitor-table-container" style={{ width: `${100 - splitPosition}%` }}>
          <h3>进程实时统计</h3>
          {allProcesses.length === 0 ? (
            <div className="table-empty">暂无进程数据</div>
          ) : (
            <div className="monitor-table-wrapper">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th>进程名</th>
                    <th>PID</th>
                    <th>CPU (%)</th>
                    <th>内存 (MB)</th>
                    <th>RSS匿名 (MB)</th>
                    <th>RSS文件 (MB)</th>
                    <th>RSS共享 (MB)</th>
                    <th>文件描述符</th>
                  </tr>
                </thead>
                <tbody>
                  {allProcesses.map(procName => {
                    const proc = processes[procName];
                    if (!proc) return null;

                    // 兼容新旧字段名
                    const processName = proc.process_name || procName;
                    const rssAnon = proc.rss_anon || proc.RssAnon || 0;
                    const rssFile = proc.rss_file || proc.RssFile || 0;
                    const rssShmem = proc.rss_shmem || proc.RssShmem || 0;
                    const fd = proc.fd || proc.FD || 0;

                    return (
                      <tr key={procName}>
                        <td className="process-name" style={{ color: colorForProcess(procName) }}>
                          {processName}
                        </td>
                        <td>{proc.pid || '-'}</td>
                        <td>{proc.cpu_usage?.toFixed(2) || '0.00'}</td>
                        <td>{proc.mem_usage?.toFixed(2) || '0.00'}</td>
                        <td>{rssAnon.toFixed(2)}</td>
                        <td>{rssFile.toFixed(2)}</td>
                        <td>{rssShmem.toFixed(2)}</td>
                        <td>{fd}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResourceMonitor;
