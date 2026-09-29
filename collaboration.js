(() => {
  const sessionKey = 'forma.roomSession';
  const session = (() => {
    try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); }
    catch { return null; }
  })();

  function requireSession() {
    if (!session || !session.room || !['teacher', 'student'].includes(session.role)) {
      window.location.replace('access.html');
      return false;
    }
    return true;
  }

  function connect(module, onState) {
    let socket;
    let retryTimer;
    let stopped = false;
    const pending = {};
    const status = document.getElementById('roomConnection');
    const updateStatus = text => { if (status) status.textContent = text; };

    function sendPending() {
      if (session.role !== 'teacher' || socket?.readyState !== WebSocket.OPEN || !Object.keys(pending).length) return;
      socket.send(JSON.stringify({ type: 'patch', module, patch: { ...pending } }));
      Object.keys(pending).forEach(key => delete pending[key]);
    }

    function openSocket() {
      if (stopped) return;
      const url = new URL('/sync', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('room', session.room);
      url.searchParams.set('role', session.role);
      if (session.role === 'teacher') url.searchParams.set('token', session.token);
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        updateStatus('EN VIVO');
        sendPending();
      });
      socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; }
        if (message.type === 'state' && message.state?.[module]) onState(message.state[module]);
      });
      socket.addEventListener('close', () => {
        updateStatus('RECONECTANDO…');
        if (!stopped) retryTimer = setTimeout(openSocket, 1200);
      });
      socket.addEventListener('error', () => updateStatus('SIN CONEXIÓN'));
    }

    openSocket();
    return {
      publish(patch) {
        if (session.role !== 'teacher') return;
        Object.assign(pending, patch);
        sendPending();
      },
      close() {
        stopped = true;
        clearTimeout(retryTimer);
        socket?.close();
      }
    };
  }

  function initializeHeader() {
    const header = document.querySelector('.topbar');
    if (!header || !session) return;
    const indicator = document.createElement('div');
    indicator.className = 'room-indicator';
    indicator.innerHTML = `<span>SALA ${session.room}</span><strong id="roomConnection">CONECTANDO…</strong>`;
    header.append(indicator);
  }

  window.SimulatorCollaboration = { session, requireSession, connect, initializeHeader };
})();
