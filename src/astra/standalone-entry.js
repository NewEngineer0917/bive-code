/**
 * 単体配布用のエントリ。
 *
 * ルータも認証も通さず、ASTRA BOND の画面だけを #root に描く。
 * 公開用の 1 ファイル HTML を作るときはここを入口にする。
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import AstraBond from '../components/AstraBond.js';

const mount = document.getElementById('root');
createRoot(mount).render(React.createElement(AstraBond));
