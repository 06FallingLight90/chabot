/**
 * 聊天记录导出 —— 把当前会话聊天记录组装为纯文本，按平台导出一键 .txt：
 * - H5：Blob 直接触发浏览器下载（带 BOM 防中文乱码）
 * - App：plus.io 写入应用文档目录（_doc），并尝试系统打开
 * - 微信小程序：小程序无法直接导出 txt 文件，降级为复制全文到剪贴板
 */

import { getChatRows, getConversations, getActiveConversationId } from './storage.js'
import { getConversationSettings } from './chat.js'

function _pad(n) {
	return String(n).padStart(2, '0')
}

function _nowText() {
	const d = new Date()
	return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())} ${_pad(d.getHours())}:${_pad(d.getMinutes())}`
}

/** 组装当前会话聊天记录文本（纯函数，供导出与测试） */
export function buildChatExportText() {
	const rows = getChatRows()
	if (!rows.length) return ''
	const conv = getConversations().find((c) => c.id === getActiveConversationId())
	const s = getConversationSettings()
	const lines = []
	lines.push(`${s.personaName} · ${(conv && conv.title) || '新对话'}`)
	lines.push(`导出时间：${_nowText()}`)
	lines.push('————————————————')
	for (const r of rows) {
		const who = r.role === 'user' ? '用户' : r.role === 'system' ? '系统' : 'AI'
		lines.push(`${who}：${r.content}`)
		lines.push('')
	}
	return lines.join('\n').trim()
}

/** 一键导出当前会话聊天记录为 .txt */
export function exportChatToFile() {
	const text = buildChatExportText()
	if (!text) {
		uni.showToast({ title: '暂无聊天记录', icon: 'none' })
		return
	}
	const d = new Date()
	const filename = `聊天记录_${d.getFullYear()}${_pad(d.getMonth() + 1)}${_pad(d.getDate())}_${_pad(d.getHours())}${_pad(d.getMinutes())}.txt`

	// #ifdef H5
	const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)
	uni.showToast({ title: '已导出：' + filename, icon: 'none' })
	// #endif

	// #ifdef APP-PLUS
	plus.io.resolveLocalFileSystemURL(
		'_doc',
		(entry) => {
			entry.getFile(
				filename,
				{ create: true },
				(fileEntry) => {
					fileEntry.createWriter(
						(writer) => {
							// plus.io 单次 write 有大小上限，超长时分段追加写入
							const CHUNK = 512 * 1024
							let offset = 0
							writer.onerror = () => uni.showToast({ title: '导出失败', icon: 'none' })
							writer.onwriteend = () => {
								if (offset < text.length) {
									const slice = text.slice(offset, offset + CHUNK)
									offset += CHUNK
									writer.write(slice)
									return
								}
								uni.showToast({ title: '已导出到文档目录：' + filename, icon: 'none' })
								// 尝试用系统应用打开（用户可另存/分享）；打不开时路径已在提示中
								try {
									plus.runtime.openFile(fileEntry.toLocalURL())
								} catch (e) {
									/* 忽略打开失败 */
								}
							}
							writer.write(text.slice(offset, offset + CHUNK))
							offset += CHUNK
						},
						() => uni.showToast({ title: '导出失败', icon: 'none' })
					)
				},
				() => uni.showToast({ title: '导出失败', icon: 'none' })
			)
		},
		() => uni.showToast({ title: '导出失败', icon: 'none' })
	)
	// #endif

	// #ifdef MP-WEIXIN
	// 小程序无法直接导出 txt 文件，降级为复制全文
	uni.setClipboardData({
		data: text,
		success: () => uni.showToast({ title: '已复制聊天记录到剪贴板', icon: 'none' })
	})
	// #endif
}
