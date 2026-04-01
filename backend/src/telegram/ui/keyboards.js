// src/telegram/ui/keyboards.js
// Construtores de InlineKeyboard para todas as telas do bot.
// Cada função retorna um objeto `reply_markup` pronto para uso no sendMessage/editMessageText.

// ── Menu principal ─────────────────────────────────────────────────────────────
export function mainMenuKeyboard(status) {
  const pauseBtn = status.paused
    ? { text: '▶️ Retomar',  callback_data: 'ctrl:resume' }
    : { text: '⏸️ Pausar',  callback_data: 'ctrl:pause'  };

  const atBtn = status.autoTrading
    ? { text: '🔇 AT: ON → OFF', callback_data: 'ctrl:at_off' }
    : { text: '🔊 AT: OFF → ON', callback_data: 'ctrl:at_on'  };

  return {
    inline_keyboard: [
      [
        { text: '📡 Status',    callback_data: 'menu:status'    },
        { text: '📊 Posições',  callback_data: 'menu:positions' },
      ],
      [
        { text: '💰 Saldo',     callback_data: 'menu:balance'   },
        { text: '📈 P&L',      callback_data: 'menu:pnl'       },
      ],
      [
        { text: '📩 Sinais',    callback_data: 'menu:signals'   },
        { text: '⚙️ Config',   callback_data: 'menu:config'    },
      ],
      [pauseBtn, atBtn],
      [
        { text: '⚠️ Fechar Tudo', callback_data: 'ctrl:close_all' },
      ],
    ],
  };
}

// ── Config/Controles ───────────────────────────────────────────────────────────
export function configKeyboard(status) {
  const atBtn = status.autoTrading
    ? { text: '❌ Desativar Auto-trading', callback_data: 'ctrl:at_off' }
    : { text: '✅ Ativar Auto-trading',    callback_data: 'ctrl:at_on'  };

  const pauseBtn = status.paused
    ? { text: '▶️ Retomar Bot', callback_data: 'ctrl:resume' }
    : { text: '⏸️ Pausar Bot',  callback_data: 'ctrl:pause'  };

  return {
    inline_keyboard: [
      [atBtn],
      [pauseBtn],
      [{ text: '◀️ Menu', callback_data: 'menu' }],
    ],
  };
}

// ── Lista de posições ──────────────────────────────────────────────────────────
export function positionsListKeyboard(positions) {
  const rows = positions.map((p, i) => {
    const pnlIcon = (p.pnlUSD ?? 0) >= 0 ? '✅' : '⛔';
    const lev     = Math.round(p.leverage ?? 0);
    const label   = `${pnlIcon} [${i + 1}] ${p.asset} ${p.direction} ⚡${lev}x`;
    return [{ text: label, callback_data: `pos:view:${p.asset}` }];
  });

  rows.push([{ text: '◀️ Menu', callback_data: 'menu' }]);
  return { inline_keyboard: rows };
}

// ── Detalhes de posição ───────────────────────────────────────────────────────
export function positionDetailKeyboard(asset) {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Atualizar',  callback_data: `pos:refresh:${asset}` },
        { text: '🔴 Fechar',     callback_data: `pos:close:${asset}`   },
      ],
      [
        { text: '🎯 Mod TP',  callback_data: `pos:tp:${asset}` },
        { text: '🛑 Mod SL',  callback_data: `pos:sl:${asset}` },
      ],
      [
        { text: '◀️ Posições', callback_data: 'menu:positions' },
        { text: '🏠 Menu',     callback_data: 'menu'           },
      ],
    ],
  };
}

// ── Tela PnL ──────────────────────────────────────────────────────────────────
export function pnlKeyboard(positions) {
  const rows = [];

  if (positions.length === 1) {
    rows.push([{ text: '🔴 Fechar a Mercado', callback_data: `pnl:close:${positions[0].asset}` }]);
  } else if (positions.length > 1) {
    rows.push([{ text: '🔴 Fechar Todas', callback_data: 'ctrl:close_all' }]);
  }

  rows.push([
    { text: '🔄 Atualizar', callback_data: 'pnl:refresh' },
    { text: '◀️ Menu',      callback_data: 'menu'        },
  ]);

  return { inline_keyboard: rows };
}

// ── Card de posição (acompanhamento automático) ───────────────────────────────
export function positionCardKeyboard(asset) {
  return {
    inline_keyboard: [[
      { text: '🔴 Fechar a Mercado', callback_data: `pos:close:${asset}`   },
      { text: '🔄 Atualizar',        callback_data: `pos:refresh:${asset}` },
    ]],
  };
}

// ── Confirmação de fechar posição ─────────────────────────────────────────────
export function confirmCloseKeyboard(asset) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: `pos:close_ok:${asset}` },
      { text: '❌ Cancelar',  callback_data: `pos:view:${asset}`     },
    ]],
  };
}

// ── Confirmação de fechar todas ───────────────────────────────────────────────
export function confirmCloseAllKeyboard() {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar FECHAR TODAS', callback_data: 'ctrl:close_all_ok'     },
      { text: '❌ Cancelar',               callback_data: 'menu:positions'         },
    ]],
  };
}

// ── Voltar ao menu ────────────────────────────────────────────────────────────
export function backToMenuKeyboard() {
  return {
    inline_keyboard: [[{ text: '◀️ Menu', callback_data: 'menu' }]],
  };
}

// ── Voltar às posições ────────────────────────────────────────────────────────
export function backToPositionsKeyboard() {
  return {
    inline_keyboard: [[{ text: '◀️ Posições', callback_data: 'menu:positions' }]],
  };
}

// ── Cancelar entrada de texto (TP/SL) ─────────────────────────────────────────
export function inputCancelKeyboard(asset) {
  return {
    inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `pos:view:${asset}` }]],
  };
}
