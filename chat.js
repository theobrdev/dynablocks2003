// Chat do DynaBlocks. Precisa que a página já tenha o cliente Supabase em `db`.
(function () {
  let me = null, friends = [], active = null, channel = null, built = false;
  const unread = {};
  const $ = id => document.getElementById(id);

  function build() {
    if (built) return;
    built = true;
    const win = document.createElement('div');
    win.id = 'chat-win';
    win.innerHTML =
      '<div class="cw-title"><span>DynaBlocks Chat</span><button id="cw-close" title="Close">X</button></div>' +
      '<div class="cw-body">' +
        '<div class="cw-main">' +
          '<div class="cw-with" id="cw-with">Select a friend to chat</div>' +
          '<div class="cw-msgs" id="cw-msgs"></div>' +
          '<div class="cw-send"><input id="cw-input" maxlength="500" placeholder="Type a message..." disabled>' +
          '<button id="cw-send" disabled>Send</button></div>' +
        '</div>' +
        '<div class="cw-side">' +
          '<div class="cw-with">Friends</div>' +
          '<ul id="cw-friends"></ul>' +
          '<div class="cw-add"><input id="cw-add-name" placeholder="Username" maxlength="20">' +
          '<button id="cw-add-btn">Add friend</button><div id="cw-note"></div></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(win);

    $('cw-close').onclick = () => { win.style.display = 'none'; };
    $('cw-send').onclick = send;
    $('cw-input').onkeydown = e => { if (e.key === 'Enter') send(); };
    $('cw-add-btn').onclick = addFriend;
    $('cw-add-name').onkeydown = e => { if (e.key === 'Enter') addFriend(); };
  }

  function note(t, ok) {
    $('cw-note').textContent = t;
    $('cw-note').className = ok ? 'ok' : 'err';
  }

  function time(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addMsg(m) {
    const mine = m.sender_id === me;
    const row = document.createElement('div');
    row.className = 'cw-msg ' + (mine ? 'mine' : 'theirs');
    const who = document.createElement('b');
    who.textContent = (mine ? 'You' : (active ? active.username : '?')) + ' ';
    const t = document.createElement('small');
    t.textContent = time(m.created_at);
    const txt = document.createElement('div');
    txt.textContent = m.body;
    row.append(who, t, txt);
    const box = $('cw-msgs');
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function renderFriends() {
    const ul = $('cw-friends');
    ul.innerHTML = '';
    if (!friends.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No friends yet. Add one below!';
      ul.appendChild(li);
      return;
    }
    friends.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f.username;
      if (active && active.id === f.id) li.className = 'sel';
      if (unread[f.id]) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = unread[f.id];
        li.appendChild(b);
      }
      li.onclick = () => selectFriend(f);
      ul.appendChild(li);
    });
  }

  async function loadFriends() {
    const { data, error } = await db.from('friendships').select('user_id, friend_id');
    if (error) { note(error.message, false); return; }
    const ids = data.map(r => r.user_id === me ? r.friend_id : r.user_id);
    friends = [];
    if (ids.length) {
      const { data: profs } = await db.from('profiles').select('id, username').in('id', ids);
      friends = (profs || []).sort((a, b) => a.username.localeCompare(b.username));
    }
    renderFriends();
  }

  async function selectFriend(f) {
    active = f;
    unread[f.id] = 0;
    renderFriends();
    $('cw-with').textContent = 'Chatting with ' + f.username;
    $('cw-input').disabled = false;
    $('cw-send').disabled = false;
    $('cw-msgs').innerHTML = '';
    const { data, error } = await db.from('messages').select('*')
      .or('and(sender_id.eq.' + me + ',recipient_id.eq.' + f.id + '),and(sender_id.eq.' + f.id + ',recipient_id.eq.' + me + ')')
      .order('created_at', { ascending: false }).limit(100);
    if (error) { $('cw-msgs').textContent = error.message; return; }
    if (active.id !== f.id) return;
    data.reverse().forEach(addMsg);
    $('cw-input').focus();
  }

  async function send() {
    const input = $('cw-input');
    const body = input.value.trim();
    if (!active || !body) return;
    input.value = '';
    const { data, error } = await db.from('messages')
      .insert({ recipient_id: active.id, body }).select().single();
    if (error) { input.value = body; note(error.message, false); return; }
    addMsg(data);
  }

  async function addFriend() {
    const name = $('cw-add-name').value.trim();
    if (!name) return;
    const { data: p } = await db.from('profiles').select('id, username')
      .ilike('username', name.replace(/[_%]/g, c => '\\' + c)).maybeSingle();
    if (!p) return note('User not found.', false);
    if (p.id === me) return note("You can't add yourself.", false);
    const { error } = await db.from('friendships').insert({ user_id: me, friend_id: p.id });
    if (error) return note(/duplicate|unique/i.test(error.message) ? 'Already your friend.' : error.message, false);
    $('cw-add-name').value = '';
    note(p.username + ' added!', true);
    loadFriends();
  }

  function subscribe() {
    if (channel) return;
    channel = db.channel('chat-' + me)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: 'recipient_id=eq.' + me },
          payload => {
            const m = payload.new;
            if (active && m.sender_id === active.id) { addMsg(m); return; }
            unread[m.sender_id] = (unread[m.sender_id] || 0) + 1;
            if (!friends.some(f => f.id === m.sender_id)) loadFriends(); else renderFriends();
          })
      .subscribe();
  }

  async function open() {
    const { data } = await db.auth.getSession();
    if (!data.session) { location.href = 'signin.html'; return; }
    me = data.session.user.id;
    build();
    $('chat-win').style.display = 'flex';
    await loadFriends();
    subscribe();
  }

  db.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      if (channel) { db.removeChannel(channel); channel = null; }
      if ($('chat-win')) $('chat-win').style.display = 'none';
      me = null; active = null; friends = [];
    }
  });

  const link = document.getElementById('open-chat');
  if (link) link.onclick = e => { e.preventDefault(); open(); };
})();
