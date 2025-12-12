<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { SvgIcon, SvgIconOnline } from '@/components/common'
import { useMessage, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useDraggable, useDebounceFn, useStorage } from '@vueuse/core'
import { 
    getNotepadList, 
    saveNotepadContent, 
    uploadNotepadFile, 
    deleteNotepad,
    type NotepadInfo 
} from '@/api/panel/notepad'
import { useAuthStore } from '@/store/modules/auth'
import { VisitMode } from '@/enums/auth'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', visible: boolean): void
}>()

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()
const editorRef = ref<HTMLDivElement | null>(null)
const notepadRef = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

// 状态 - 使用 useStorage 持久化
const currentNote = useStorage<Partial<NotepadInfo>>('sun-panel-notepad-current', { id: 0, title: '', content: '' })
const noteList = useStorage<NotepadInfo[]>('sun-panel-notepad-list', [])
const showList = ref(false)

// 窗口初始位置
const { x, y } = useDraggable(notepadRef, {
  initialValue: { x: window.innerWidth - 370, y: 80 },
  handle: headerRef
})

// 初始化
onMounted(async () => {
    // 预加载：只有当本地缓存为空时才请求
    if (noteList.value.length === 0) {
        await loadList()
    }
})

// 加载列表
const loadList = async () => {
    // 检查用户是否已登录，未登录则不请求接口
    if (!authStore.token) {
        return
    }
    try {
        const res = await getNotepadList()
        if (res.code === 0) {
            noteList.value = res.data || []
        }
    } catch (e) {
        console.error('Load list error', e)
    }
}

// 生成标题（现在接受内容参数，或者直接读取editor）
const generateTitle = (textContent?: string) => {
    // 优先：检查是否有 H1 标签，如果有，将其作为标题
    if (editorRef.value) {
        const h1 = editorRef.value.querySelector('h1')
        if (h1 && h1.innerText.trim()) {
            return h1.innerText.trim()
        }
    }

    const text = textContent !== undefined ? textContent : (editorRef.value?.innerText.trim() || '')
    if (text) {
        return text.substring(0, 5)
    }
    if (currentNote.value.id) {
        return `便签${currentNote.value.id}` 
    }
    return `便签${noteList.value.length + 1}`
}

// 输入处理
const handleInput = () => {
    if (!editorRef.value) return
    // 实时更新标题
    const text = editorRef.value.innerText.trim()
     currentNote.value.title = generateTitle(text)
    // 触发保存
    saveContent()
}

// 核心保存逻辑
const handleSave = async () => {
    if (editorRef.value) {
        try {
            const content = editorRef.value.innerHTML
            const text = editorRef.value.innerText.trim()
            const title = generateTitle(text)
            const saveId = currentNote.value.id || 0 // 保存时的ID快照
            
            const res = await saveNotepadContent({ 
                id: saveId,
                title: title,
                content: content 
            })
            
            if (res.code === 0) {
                // 并发检查：如果当前编辑器已经切换到别的便签（或者新建了），则不覆盖 currentNote
                if (currentNote.value.id === saveId) {
                    currentNote.value = res.data
                }
                // 刷新列表
                await loadList()
            }
        } catch (error) {
            console.error('Save notepad error:', error)
        }
    }
}

// 保存内容（防抖）
const saveContent = useDebounceFn(handleSave, 1000)

// 切换便签
const selectNote = (note: NotepadInfo) => {
    currentNote.value = { ...note } // 立即切换状态
    if (editorRef.value) {
        editorRef.value.innerHTML = note.content || ''
    }
    showList.value = false
}

// 新建便签
const createNew = () => {
    // 不强制 flush，直接切换状态。旧的 saveContent 如果在跑，会因 ID 不匹配而被忽略更新 currentNote
    currentNote.value = { id: 0, title: `便签${noteList.value.length + 1}`, content: '' }
    if (editorRef.value) {
        editorRef.value.innerHTML = ''
        editorRef.value.focus() // 聚焦
    }
    showList.value = false
}

// 暴露刷新方法给父组件
const refreshData = async () => {
    await loadList()
}
defineExpose({ refreshData })

// 监听显示状态
watch(() => props.visible, (val) => {
    if (val) {
        initData()
    } else {
        // 关闭时，立即执行保存
        handleSave()
    }
})

// 删除便签
const deleteNote = async (note: NotepadInfo) => {
    dialog.warning({
        title: t('common.warning'),
        content: t('common.deleteConfirmByName', { name: note.title || '便签' }), 
        positiveText: t('common.confirm'),
        negativeText: t('common.cancel'),
        onPositiveClick: async () => {
            try {
                const res = await deleteNotepad({ id: note.id })
                if (res.code === 0) {
                    message.success(t('common.deleteSuccess'))
                    await loadList()
                    // 如果删除的是当前选中的
                    if (currentNote.value.id === note.id) {
                        if (noteList.value.length > 0) {
                            selectNote(noteList.value[0])
                        } else {
                            createNew()
                        }
                    }
                }
            } catch (e) {
                message.error(t('common.deleteFail'))
            }
        }
    })
}

// 插入文件/图片
const insertFileLink = (fileInfo: { name: string, type: string, url: string }) => {
    if (!editorRef.value) return
    
    let htmlFragment = ''
    let fullUrl = fileInfo.url
    
    if (fileInfo.type.startsWith('image/')) {
        htmlFragment = `<div><img class="note-image" src="${fullUrl}" alt="${fileInfo.name}" /></div>`
    } else {
        htmlFragment = `&nbsp;<a href="${fullUrl}" target="_blank" class="file-attachment" contenteditable="false" title="${t('notepad.clickToDownload')}">📁&nbsp;${fileInfo.name}</a>&nbsp;`
    }
    
    editorRef.value.insertAdjacentHTML('beforeend', htmlFragment)
    saveContent() // 触发保存
    
    nextTick(() => {
        if (editorRef.value) {
           editorRef.value.scrollTop = editorRef.value.scrollHeight
        }
    })
}

// 通用上传逻辑
const uploadFile = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
        const res = await uploadNotepadFile(formData)
        if (res.code === 0) {
            const data = res.data
            insertFileLink({
                name: data.name || file.name,
                type: data.type || file.type,
                url: data.url
            })
        } else {
             message.error(t('notepad.saveFailed'))
        }
    } catch (e) {
        message.error(t('notepad.saveFailed'))
    }
}

// 处理拖拽上传
const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (e.dataTransfer && e.dataTransfer.files) {
        const files = Array.from(e.dataTransfer.files)
        for (const file of files) {
            await uploadFile(file)
        }
    }
}

// 触发文件选择
const triggerUpload = () => {
    fileInputRef.value?.click()
}

// 处理文件选择
const handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
        const files = Array.from(input.files)
        for (const file of files) {
             await uploadFile(file)
        }
        input.value = '' 
    }
}

const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
}

// 工具栏操作
const execCommand = (command: string, value?: string) => {
    if (command === 'removeFormat') {
        // 清除内联格式（粗体、斜体等）
        document.execCommand('removeFormat', false, value)
        // 重置块级格式（标题、代码块等）为普通文本 div
        document.execCommand('formatBlock', false, 'div')
    } else {
        document.execCommand(command, false, value)
        
        // 特殊处理：如果插入了代码块，确保后面有一个空行，方便跳出
        if (command === 'formatBlock' && value === 'PRE') {
            const selection = window.getSelection()
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0)
                let node = range.commonAncestorContainer
                // 如果是文本节点，取父节点
                if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
                    node = node.parentNode
                }
                
                // 向上查找 PRE 元素
                let el = node as HTMLElement
                while (el && el.tagName !== 'PRE' && el !== editorRef.value) {
                    if (!el.parentElement) break
                    el = el.parentElement
                }
                
                // 如果找到了 PRE 且它是最后一个元素，插入一个空 div
                if (el && el.tagName === 'PRE') {
                    if (!el.nextElementSibling) {
                        const div = document.createElement('div')
                        div.innerHTML = '<br>'
                        el.parentNode?.insertBefore(div, el.nextSibling)
                    }
                }
            }
        }
    }
    handleInput()
}

// 初始化/打开时加载
const initData = async () => {
    await loadList()
    
    // 如果列表为空，保持新建状态
    if (noteList.value.length === 0) {
        if (currentNote.value.id !== 0) {
             createNew()
        }
        return
    }

    // 如果只是打开（id=0且空），选中第一个
    if (currentNote.value.id === 0 && !currentNote.value.content && !currentNote.value.title) {
        selectNote(noteList.value[0])
    } else {
        // 如果当前有选中的ID，检查是否还在列表中
        const exist = noteList.value.find(n => n.id === currentNote.value.id)
        if (exist) {
            // 同步数据：使用最新的服务器数据更新当前便签
            currentNote.value = { ...exist }
            if (editorRef.value) {
                const isFocused = document.activeElement === editorRef.value
                editorRef.value.innerHTML = exist.content || ''
                 // 如果之前由焦点保留焦点（虽然打开时不应该有焦点）
                if (isFocused) {
                    // restore cursor? 比较复杂，但在打开瞬间通常不需要。
                }
            }
        } else {
            // 如果不在了，选中第一个
            selectNote(noteList.value[0])
        }
    }
}





// 处理关闭
const close = () => {
    emit('update:visible', false)
}
</script>

<template>
  <!-- 遮罩层，点击关闭 -->
  <div v-if="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN" v-show="visible" class="fixed inset-0 z-[100] bg-transparent" @click="close"></div>

  <!-- 便签主体 -->
  <transition name="note-fade">
    <div
        v-if="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN"
        v-show="visible"
        ref="notepadRef"
        class="fixed z-[101] w-[350px] h-[45vh] flex flex-col shadow-xl rounded-lg overflow-hidden border border-amber-200"
        :style="{ left: x + 'px', top: y + 'px' }"
        @click.stop
        @dragover="handleDragOver"
        @drop="handleDrop"
    >
      <!-- 头部 -->
      <div ref="headerRef" class="h-8 bg-[#fef3c7] flex justify-between items-center px-2 border-b border-[#feebc8] select-none cursor-move shrink-0">
         <div class="flex items-center text-amber-800 text-sm font-bold cursor-pointer hover:bg-amber-200 rounded px-1 -ml-1 transition-colors" @click="showList = !showList">
            <SvgIcon icon="note" class="mr-1" />
            <span class="truncate max-w-[120px]" :title="currentNote.title">
                {{ t('notepad.title') }} <span v-if="currentNote.title && currentNote.title !== t('notepad.title')">- {{ currentNote.title }}</span>
            </span>
            <SvgIconOnline icon="mdi:chevron-down" class="ml-1 text-xs opacity-60" />
         </div>
         
         <div class="flex items-center gap-1">
             <!-- New Note Button -->
             <div class="hover:bg-amber-200 rounded p-0.5 cursor-pointer text-amber-900" title="New Note" @click="createNew">
                <SvgIconOnline icon="mdi:plus" />
             </div>
             <!-- Upload Button -->
             <div class="hover:bg-amber-200 rounded p-0.5 cursor-pointer text-amber-900" title="Upload" @click="triggerUpload">
                <SvgIconOnline icon="mdi:folder-open-outline" />
             </div>
             <!-- Close Button -->
             <div class="hover:bg-amber-200 rounded p-0.5 cursor-pointer text-amber-900" @click="close">
                <SvgIconOnline icon="mdi:close" />
             </div>
         </div>
      </div>
      
      <!-- Hidden Input -->
      <input ref="fileInputRef" type="file" multiple style="display: none" @change="handleFileSelect" />

      <!-- 编辑区 & 列表区 -->
      <div class="flex-1 bg-[#fffbeb] relative overflow-hidden flex flex-col">
         
         <!-- 内容区域容器 -->
         <div class="flex-1 relative overflow-hidden">
             <!-- 列表侧边栏 -->
             <transition name="slide-fade">
                <div v-show="showList" class="absolute inset-0 z-10 bg-[#fffbeb]/95 backdrop-blur-sm border-r border-[#feebc8] flex flex-col">
                    <div class="p-2 space-y-1 overflow-y-auto flex-1">
                        <div v-if="noteList.length === 0" class="text-center text-gray-400 text-xs py-4">
                            {{ t('notepad.noData') }}
                        </div>
                        <div 
                            v-for="item in noteList" 
                            :key="item.id"
                            class="group flex justify-between items-center p-2 rounded text-sm text-gray-700 hover:bg-amber-100 cursor-pointer transition-colors"
                            :class="{'bg-amber-200 font-medium text-amber-900': item.id === currentNote.id}"
                            @click="selectNote(item)"
                        >
                            <span class="truncate flex-1">{{ item.title || '便签' }}</span>
                            <div class="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 text-red-500 rounded transition-all" @click.stop="deleteNote(item)">
                                <SvgIconOnline icon="mdi:trash-can-outline" />
                            </div>
                        </div>
                    </div>
                </div>
             </transition>

             <!-- ContentEditable Div -->
             <div
                ref="editorRef"
                contenteditable="true"
                class="w-full h-full p-3 outline-none overflow-y-auto text-sm text-gray-800 break-words font-sans leading-relaxed"
                :data-placeholder="t('notepad.placeholder')"
                 @input="handleInput"
                spellcheck="false"
             ></div>
         </div>

         <!-- 底部工具栏 -->
         <div class="h-9 bg-[#fef3c7] border-t border-amber-200 flex items-center px-2 gap-1 overflow-x-auto text-amber-800 shrink-0">
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('bold')" title="粗体">
                <SvgIconOnline icon="mdi:format-bold" />
             </div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('italic')" title="斜体">
                <SvgIconOnline icon="mdi:format-italic" />
             </div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('strikeThrough')" title="删除线">
                <SvgIconOnline icon="mdi:format-strikethrough-variant" />
             </div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('insertHorizontalRule')" title="分割线">
                <SvgIconOnline icon="mdi:minus" />
             </div>
             <div class="w-[1px] h-4 bg-amber-300 mx-1"></div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('formatBlock', 'H1')" title="标题1">
                <SvgIconOnline icon="mdi:format-header-1" />
             </div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('formatBlock', 'H2')" title="标题2">
                <SvgIconOnline icon="mdi:format-header-2" />
             </div>
             <div class="w-[1px] h-4 bg-amber-300 mx-1"></div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('insertUnorderedList')" title="无序列表">
                <SvgIconOnline icon="mdi:format-list-bulleted" />
             </div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('insertOrderedList')" title="有序列表">
                <SvgIconOnline icon="mdi:format-list-numbered" />
             </div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('formatBlock', 'PRE')" title="代码块">
                <SvgIconOnline icon="mdi:code-tags" />
             </div>
             <div class="w-[1px] h-4 bg-amber-300 mx-1"></div>
             <div class="p-1 hover:bg-amber-200 rounded cursor-pointer transition-colors" @mousedown.prevent="execCommand('removeFormat')" title="清除格式">
                <SvgIconOnline icon="mdi:format-clear" />
             </div>
         </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.note-fade-enter-active,
.note-fade-leave-active {
  transition: all 0.2s ease;
}

.note-fade-enter-from,
.note-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

:deep(.file-attachment) {
    display: inline-flex;
    align-items: center;
    background-color: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 4px;
    padding: 0 4px;
    margin: 0 2px;
    font-size: 0.85em;
    color: #c2410c;
    cursor: pointer;
    user-select: none;
    transition: all 0.2s;
    text-decoration: none;
}

:deep(.file-attachment:hover) {
    background-color: #ffedd5;
    border-color: #fdba74;
}

:deep(.note-image) {
    max-width: 100%;
    max-height: 150px;
    border-radius: 4px;
    margin: 4px 0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    display: block;
    cursor: default;
}

/* 编辑器内部样式 */
:deep(h1) {
    font-size: 1.5em;
    font-weight: bold;
    margin: 0.5em 0 0.25em 0;
    line-height: 1.3;
    color: #1f2937;
}
:deep(h2) {
    font-size: 1.25em;
    font-weight: bold;
    margin: 0.5em 0 0.25em 0;
    line-height: 1.4;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
}
:deep(ul) {
    list-style-type: disc;
    padding-left: 1.5em;
    margin: 0.5em 0;
}
:deep(ol) {
    list-style-type: decimal;
    padding-left: 1.5em;
    margin: 0.5em 0;
}
:deep(li) {
    margin: 0.2em 0;
}
:deep(pre) {
    background-color: #1e293b; /* slate-800 */
    color: #e2e8f0; /* slate-200 */
    padding: 0.75em;
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9em;
    line-height: 1.5;
    margin: 0.5em 0;
    white-space: pre-wrap;
    overflow-x: auto;
}
:deep(blockquote) {
    border-left: 4px solid #cbd5e1;
    padding-left: 1em;
    margin: 0.5em 0;
    color: #64748b;
    font-style: italic;
}
:deep(b), :deep(strong) {
    font-weight: bold;
}
:deep(i), :deep(em) {
    font-style: italic;
}
:deep(s), :deep(strike) {
    text-decoration: line-through;
}
:deep(hr) {
    border: 0;
    border-top: 1px solid #78350f; /* Amber-900 like */
    opacity: 0.2;
    margin: 1em 0;
}

/* 占位符效果 */
div[contenteditable]:empty::before {
  content: attr(data-placeholder);
  color: #9ca3af;
  pointer-events: none;
  font-style: italic;
}
</style>
