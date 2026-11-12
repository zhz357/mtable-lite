//
// views/iconpicker.js — 图标选择器（移植自 IconPickerView.swift）
//
import { el, clear } from '../ui.js';
import { icon } from '../icons.js';

/// 常用图标列表（与 Swift IconPickerView.icons 顺序一致，对应 icons.js 中同名条目）
const ICON_NAMES = [
  'folder', 'folder.fill',
  'house', 'house.fill',
  'star', 'star.fill',
  'heart', 'heart.fill',
  'bell', 'bell.fill',
  'gear', 'gearshape', 'gearshape.fill',
  'person', 'person.fill',
  'person.2', 'person.2.fill',
  'briefcase', 'briefcase.fill',
  'doc.text', 'doc.text.fill',
  'note.text', 'note.text.fill',
  'book', 'book.fill',
  'bookmark', 'bookmark.fill',
  'link', 'link.badge.plus',
  'globe', 'network',
  'bolt', 'bolt.fill',
  'flame', 'flame.fill',
  'moon', 'moon.fill',
  'sun.max', 'sun.max.fill',
  'cloud', 'cloud.fill',
  'film', 'film.fill',
  'music.note', 'music.note.list',
  'photo', 'photo.fill',
  'camera', 'camera.fill',
  'mic', 'mic.fill',
  'video', 'video.fill',
  'tv', 'tv.fill',
  'gamecontroller', 'gamecontroller.fill',
  'cart', 'cart.fill',
  'bag', 'bag.fill',
  'creditcard', 'creditcard.fill',
  'banknote', 'banknote.fill',
  'dollarsign.circle', 'dollarsign.circle.fill',
  'chart.bar', 'chart.pie',
  'chart.line.uptrend.xyaxis',
  'magnifyingglass',
  'rectangle.stack', 'rectangle.stack.fill',
  'archivebox', 'archivebox.fill',
  'tray', 'tray.fill',
  'tag', 'tag.fill',
  'paperplane', 'paperplane.fill',
  'envelope', 'envelope.fill',
  'phone', 'phone.fill',
  'message', 'message.fill',
  'bubble.left', 'bubble.left.fill',
  'command', 'option',
  'keyboard', 'keyboard.fill',
  'printer', 'printer.fill',
  'desktopcomputer',
  'laptopcomputer',
  'iphone',
  'ipad',
  'watch',
  'headphones',
  'server.rack',
  'externaldrive', 'externaldrive.fill',
  'paintbrush', 'paintbrush.fill',
  'pencil', 'pencil.circle',
  'scissors',
  'wand.and.stars',
  'sparkles',
  'leaf', 'leaf.fill',
  'flag', 'flag.fill',
  'pin', 'pin.fill',
  'map', 'map.fill',
  'location', 'location.fill',
  'car', 'car.fill',
  'airplane',
  'tram',
  'bicycle',
  'figure.walk',
  'figure.run',
  'sportscourt',
  'soccerball',
  'basketball',
  'tennis.racket',
  'dumbbell',
  'pills', 'pills.fill',
  'cross.case', 'cross.case.fill',
  'stethoscope',
  'graduationcap', 'graduationcap.fill',
  'building.columns', 'building.columns.fill',
  'cube', 'cube.fill',
  'puzzlepiece', 'puzzlepiece.fill',
  'checkmark.seal', 'checkmark.seal.fill',
  'rosette',
  'trophy', 'trophy.fill',
  'medal', 'medal.fill',
  'gift', 'gift.fill',
  'cup.and.saucer', 'cup.and.saucer.fill',
  'fork.knife',
  'takeoutbag.and.cup.and.straw',
  'birthday.cake',
  'hourglass',
  'timer',
  'stopwatch',
  'calendar',
  'clock',
  'alarm',
  'lightbulb', 'lightbulb.fill',
  'eye', 'eye.fill',
  'eyeglasses',
  'face.smiling',
  'hand.thumbsup', 'hand.thumbsup.fill',
  'hand.raised', 'hand.raised.fill',
  'arrow.right.circle', 'arrow.right.circle.fill',
  'arrow.2.circlepath',
  'arrow.triangle.2.circlepath',
  'plus.circle', 'plus.circle.fill',
  'minus.circle', 'minus.circle.fill',
  'xmark.circle', 'xmark.circle.fill',
  'exclamationmark.circle', 'exclamationmark.circle.fill',
  'questionmark.circle', 'questionmark.circle.fill',
  'info.circle', 'info.circle.fill',
  'checkmark.circle', 'checkmark.circle.fill',
  'multiply.circle',
  'plus.square', 'plus.square.fill',
];

/**
 * 图标选择网格（对应 IconPickerView：6 列 40px，选中态蓝底白图标）
 * @param {{ selected?: string, onSelect?: (name: string) => void, onClose?: () => void }} opts
 */
export function IconPickerView({ selected, onSelect, onClose } = {}) {
  let current = selected || null;
  const grid = el('div', { class: 'iconpicker-grid' });

  function render() {
    clear(grid);
    for (const name of ICON_NAMES) {
      const isSel = name === current;
      grid.append(el('button', {
        class: `iconpicker-item${isSel ? ' selected' : ''}`,
        type: 'button',
        title: name,
        onclick: () => {
          current = name;
          render();
          if (onSelect) onSelect(name);
        },
      }, el('span', { class: 'icon', innerHTML: icon(name) })));
    }
  }

  render();
  return grid;
}
