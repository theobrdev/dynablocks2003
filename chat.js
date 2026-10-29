// Chat do DynaBlocks (usado por chat.html). Precisa do cliente Supabase em `db`.
(function () {
  let me = null, friends = [], active = null, channel = null;
  const unread = {};
  const $ = id => document.getElementById(id);

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
    renderBody(txt, m.body);
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

  // ---------- Emoticons do MSN Messenger ----------
  // Imagens: pasta img/emoticons/ (arquivos .png da pasta "original" do repositório bernzrdo/msn-emoticons)
  const EMO_PATH = 'img/emoticons/';
  const EMOTICONS = [
    ['smile', ':)', 'Smile'], ['open-mouthed-smile', ':D', 'Open-mouthed smile'], ['winking-smile', ';)', 'Winking smile'],
    ['surprised-smile', ':-O', 'Surprised smile'], ['smile-with-tongue-out', ':P', 'Smile with tongue out'],
    ['hot-smile', '(H)', 'Hot smile'], ['angry-smile', ':@', 'Angry smile'], ['embarrassed-smile', ':$', 'Embarrassed smile'],
    ['confused-smile', ':S', 'Confused smile'], ['sad-smile', ':(', 'Sad smile'], ['crying-face', ":'(", 'Crying face'],
    ['disappointed-smile', ':|', 'Disappointed smile'], ['devil', '(6)', 'Devil'], ['angel', '(A)', 'Angel'],
    ['red-heart', '(L)', 'Red heart'], ['broken-heart', '(U)', 'Broken heart'], ['messenger', '(M)', 'Messenger'],
    ['cat-face', '(@)', 'Cat face'], ['dog-face', '(&)', 'Dog face'], ['sleeping-half-moon', '(S)', 'Sleeping half-moon'],
    ['star', '(*)', 'Star'], ['filmstrip', '(~)', 'Filmstrip'], ['note', '(8)', 'Note'], ['e-mail', '(E)', 'E-mail'],
    ['red-rose', '(F)', 'Red rose'], ['wilted-rose', '(W)', 'Wilted rose'], ['clock', '(O)', 'Clock'],
    ['red-lips', '(K)', 'Red lips'], ['gift-with-a-bow', '(G)', 'Gift with a bow'], ['birthday-cake', '(^)', 'Birthday cake'],
    ['camera', '(P)', 'Camera'], ['light-bulb', '(I)', 'Light bulb'], ['coffee-cup', '(C)', 'Coffee cup'],
    ['telephone-receiver', '(T)', 'Telephone receiver'], ['left-hug', '({)', 'Left hug'], ['right-hug', '(})', 'Right hug'],
    ['beer-mug', '(B)', 'Beer mug'], ['martini-glass', '(D)', 'Martini glass'], ['boy', '(Z)', 'Boy'], ['girl', '(X)', 'Girl'],
    ['thumbs-up', '(Y)', 'Thumbs up'], ['thumbs-down', '(N)', 'Thumbs down'], ['vampire-bat', ':[', 'Vampire bat'],
    ['goat', '(nnh)', 'Goat'], ['sun', '(#)', 'Sun'], ['rainbow', '(R)', 'Rainbow'],
    ['dont-tell-anyone-smile', ':-#', "Don't tell anyone smile"], ['baring-teeth-smile', '8o|', 'Baring teeth smile'],
    ['nerd-smile', '8-|', 'Nerd smile'], ['sarcastic-smile', '^o)', 'Sarcastic smile'],
    ['secret-telling-smile', ':-*', 'Secret telling smile'], ['sick-smile', '+o(', 'Sick smile'], ['snail', '(sn)', 'Snail'],
    ['turtle', '(tu)', 'Turtle'], ['plate', '(pl)', 'Plate'], ['bowl', '(||)', 'Bowl'], ['pizza', '(pi)', 'Pizza'],
    ['soccer-ball', '(so)', 'Soccer ball'], ['auto', '(au)', 'Auto'], ['airplane', '(ap)', 'Airplane'],
    ['umbrella', '(um)', 'Umbrella'], ['island-with-a-palm-tree', '(ip)', 'Island with a palm tree'],
    ['computer', '(co)', 'Computer'], ['mobile-phone', '(mp)', 'Mobile phone'], ['be-right-back', '(brb)', 'Be right back'],
    ['storm-cloud', '(st)', 'Storm cloud'], ['high-five', '(h5)', 'High five!'], ['money', '(mo)', 'Money'],
    ['black-sheep', '(bah)', 'Black sheep'], ['i-dont-know-smile', ':^)', "I don't know smile"],
    ['thinking-smile', '*-)', 'Thinking smile'], ['lightning', '(li)', 'Lightning'], ['party-smile', '<:o)', 'Party smile'],
    ['eye-rolling-smile', '8-)', 'Eye-rolling smile'], ['sleepy-smile', '|-)', 'Sleepy smile'], ['bunny', "('.')", 'Bunny']
  ];
  // formas alternativas que o MSN também aceitava
  const ALIASES = { ':-)': 'smile', ':-D': 'open-mouthed-smile', ';-)': 'winking-smile', ':-P': 'smile-with-tongue-out',
    ':O': 'surprised-smile', ':-@': 'angry-smile', ':-(': 'sad-smile', ':-S': 'confused-smile', ':-|': 'disappointed-smile' };

  const byShortcut = {};                 // atalho (minúsculo) -> { file, name, sc }
  const byFile = {};
  EMOTICONS.forEach(([file, sc, name]) => { byFile[file] = { file, name, sc }; byShortcut[sc.toLowerCase()] = byFile[file]; });
  Object.keys(ALIASES).forEach(a => { byShortcut[a.toLowerCase()] = byFile[ALIASES[a]]; });
  const EMO_RE = new RegExp(Object.keys(byShortcut).sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');

  // se a imagem não existir, mostra o próprio atalho em texto
  function emoImg(e, shown) {
    const img = document.createElement('img');
    img.className = 'emo';
    img.src = EMO_PATH + e.file + '.png';
    img.alt = shown;
    img.title = e.name + '  ' + e.sc;
    img.onerror = () => img.replaceWith(document.createTextNode(shown));
    return img;
  }
  // coloca o texto da mensagem em el, trocando atalhos por imagens (só texto e <img> fixas: nada de HTML do usuário)
  function renderBody(el, text) {
    let last = 0, m;
    EMO_RE.lastIndex = 0;
    while ((m = EMO_RE.exec(text))) {
      if (m.index > last) el.append(document.createTextNode(text.slice(last, m.index)));
      el.append(emoImg(byShortcut[m[0].toLowerCase()], m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) el.append(document.createTextNode(text.slice(last)));
  }

  function setupEmoticons() {
    const style = document.createElement('style');
    style.textContent =
      '.cw-main{position:relative}' +
      '.emo{height:19px;width:auto;vertical-align:middle}' +
      '#cw-emo{padding:1px 5px;cursor:pointer}#cw-emo .emo{height:17px;vertical-align:middle}' +
      '.emo-panel{display:none;position:absolute;left:0;bottom:36px;width:316px;max-width:100%;max-height:180px;overflow:auto;' +
      'background:#fff;border:2px outset #fff;padding:4px;z-index:5;box-shadow:2px 2px 8px rgba(0,0,0,.4);' +
      'grid-template-columns:repeat(9,1fr);gap:2px}' +
      '.emo-panel.open{display:grid}' +
      '.emo-cell{height:30px;padding:0;border:1px solid transparent;background:none;cursor:pointer;font-size:10px}' +
      '.emo-cell:hover{background:#e6efff;border-color:#99b}';
    document.head.appendChild(style);

    const input = $('cw-input'), send = $('cw-send');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'cw-emo'; btn.title = 'Emoticons';
    btn.appendChild(emoImg(byFile.smile, ':)'));
    send.parentNode.insertBefore(btn, send);

    const panel = document.createElement('div');
    panel.className = 'emo-panel';
    EMOTICONS.forEach(([file, sc]) => {
      const cell = document.createElement('button');
      cell.type = 'button'; cell.className = 'emo-cell';
      cell.appendChild(emoImg(byFile[file], sc));
      cell.onclick = () => {
        const s = input.selectionStart == null ? input.value.length : input.selectionStart;
        const e = input.selectionEnd == null ? s : input.selectionEnd;
        if (input.value.length - (e - s) + sc.length > input.maxLength) return;
        input.value = input.value.slice(0, s) + sc + input.value.slice(e);
        input.selectionStart = input.selectionEnd = s + sc.length;
        input.focus();
      };
      panel.appendChild(cell);
    });
    input.parentNode.parentNode.appendChild(panel);

    btn.onclick = () => { if (!input.disabled) panel.classList.toggle('open'); };
    document.addEventListener('mousedown', ev => {
      if (!panel.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) panel.classList.remove('open');
    });
  }

  async function init() {
    const { data } = await db.auth.getSession();
    if (!data.session) { location.href = 'signin.html'; return; }
    me = data.session.user.id;

    setupEmoticons();
    $('cw-send').onclick = send;
    $('cw-input').onkeydown = e => { if (e.key === 'Enter') send(); };
    $('cw-add-btn').onclick = addFriend;
    $('cw-add-name').onkeydown = e => { if (e.key === 'Enter') addFriend(); };

    await loadFriends();
    subscribe();
  }

  db.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      if (channel) { db.removeChannel(channel); channel = null; }
      location.href = 'index.html';
    }
  });

  init();
})();
