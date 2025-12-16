<script setup lang="ts">
import { defineEmits, onMounted, ref, computed, nextTick, watch } from 'vue'
import { NAvatar, NCheckbox } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useModuleConfig } from '@/store/modules'
import { useAuthStore } from '@/store'
import { VisitMode } from '@/enums/auth'

import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

withDefaults(defineProps<{
  background?: string
  textColor?: string
}>(), {
  background: '#2a2a2a6b',
  textColor: 'white',
})

const emits = defineEmits(['itemSearch'])

interface State {
  currentSearchEngine: DeskModule.SearchBox.SearchEngine
  searchEngineList: DeskModule.SearchBox.SearchEngine[]
  newWindowOpen: boolean
}

interface SuggestionItem {
  value: string
  [key: string]: any // 其他可能的属性
}

const moduleConfigName = 'deskModuleSearchBox'
const moduleConfig = useModuleConfig()
const authStore = useAuthStore()
const searchTerm = ref('')
const isFocused = ref(false)
const searchSelectListShow = ref(false)
const suggestionsVisible = ref(false)
const dropdownPosition = ref<'bottom' | 'top'>('bottom')
const searchInputRef = ref<HTMLInputElement | null>(null)
const dropdownRef = ref<HTMLDivElement | null>(null)
const suggestionOptions = ref<SuggestionItem[]>([])

// 键盘导航相关
const selectedIndex = ref(-1)

// 加载状态
const loadingSuggestions = ref(false)

const defaultSearchEngineList = ref<DeskModule.SearchBox.SearchEngine[]>([
  {
    iconSrc: SvgSrcGoogle,
    title: 'Google',
    url: 'https://www.google.com/search?q=%s',
  },
  {
    iconSrc: SvgSrcBaidu,
    title: 'Baidu',
    url: 'https://www.baidu.com/s?wd=%s',
  },
  {
    iconSrc: SvgSrcBing,
    title: 'Bing',
    url: 'https://www.bing.com/search?q=%s',
  },
])

const defaultState: State = {
  currentSearchEngine: defaultSearchEngineList.value[0],
  searchEngineList: [] || defaultSearchEngineList,
  newWindowOpen: false,
}

const state = ref<State>({ ...defaultState })

// 过滤后的提示词选项
const filteredSuggestions = computed(() => {
  return suggestionOptions.value.slice(0, 8)
})

// 监听搜索词变化，获取动态提示词
watch(searchTerm, async (newVal) => {
  // 重置选中索引
  selectedIndex.value = -1
  
  if (newVal) {
    await fetchSuggestions(newVal)
  } else {
    suggestionOptions.value = []
  }
})

// 获取搜索引擎对应的提示词API
const getSuggestionApiUrl = (engine: DeskModule.SearchBox.SearchEngine, keyword: string): string | null => {
  // 根据搜索引擎返回对应的API URL
  if (engine.title === 'Baidu') {
    // 百度搜索建议API
    return `https://sp0.baidu.com/5a1Fazu8AA54nxGko9WTAnF6hhy/su?wd=${encodeURIComponent(keyword)}&cb=callback`
  } else if (engine.title === 'Google') {
    // Google搜索建议API (JSONP格式)
    return `https://suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&q=${encodeURIComponent(keyword)}&jsonp=callback`
  } else if (engine.title === 'Bing') {
    // Bing搜索建议API (JSONP格式)
    return `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(keyword)}&JsonType=callback&JsonCallback=callback`
  }
  return null
}

// 获取搜索建议
const fetchSuggestions = async (keyword: string) => {
  if (!keyword) return

  loadingSuggestions.value = true
  try {
    const apiUrl = getSuggestionApiUrl(state.value.currentSearchEngine, keyword)
    if (!apiUrl) {
      // 如果没有对应API，使用默认建议
      suggestionOptions.value = getDefaultSuggestions(keyword)
      return
    }

    // 特殊处理百度的JSONP请求
    if (state.value.currentSearchEngine.title === 'Baidu') {
      await fetchBaiduSuggestions(apiUrl, keyword)
    } else if (state.value.currentSearchEngine.title === 'Google') {
      // 特殊处理Google的JSONP请求
      await fetchGoogleSuggestions(apiUrl, keyword)
    } else if (state.value.currentSearchEngine.title === 'Bing') {
      // 特殊处理Bing的JSONP请求
      await fetchBingSuggestions(apiUrl, keyword)
    }
  } catch (error) {
    console.error('获取搜索建议失败:', error)
    // 出错时使用默认建议
    suggestionOptions.value = getDefaultSuggestions(keyword)
  } finally {
    loadingSuggestions.value = false
  }
}

// 获取百度搜索建议（JSONP处理）
const fetchBaiduSuggestions = (apiUrl: string, keyword: string) => {
  return new Promise<void>((resolve, reject) => {
    // 创建script标签发送JSONP请求
    const script = document.createElement('script')
    const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random())

    // 定义全局回调函数
    ;(window as any)[callbackName] = function(data: any) {
      try {
        // 清理
        document.body.removeChild(script)
        delete (window as any)[callbackName]

        // 处理百度返回的数据: {q: "keyword", p: false, s: ["suggestion1", "suggestion2", ...]}
        if (data && Array.isArray(data.s)) {
          suggestionOptions.value = data.s.map((item: string) => ({ value: item }))
        }
        resolve()
      } catch (error) {
        reject(error)
      }
    }

    script.src = apiUrl.replace('callback', callbackName)
    script.onerror = () => {
      document.body.removeChild(script)
      delete (window as any)[callbackName]
      reject(new Error('JSONP请求失败'))
    }

    document.body.appendChild(script)
  })
}

// 获取Google搜索建议（JSONP处理）
const fetchGoogleSuggestions = (apiUrl: string, keyword: string) => {
  return new Promise<void>((resolve, reject) => {
    // 创建script标签发送JSONP请求
    const script = document.createElement('script')
    const callbackName = 'google_jsonp_callback_' + Math.round(100000 * Math.random())

    // 定义全局回调函数
    ;(window as any)[callbackName] = function(data: any) {
      try {
        // 清理
        document.body.removeChild(script)
        delete (window as any)[callbackName]

        // 处理Google返回的数据: ["keyword", ["suggestion1", "suggestion2", ...], [], {...}]
        // 第二个元素是包含搜索建议的数组
        if (data && Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
          // 确保我们只提取实际的建议字符串
          suggestionOptions.value = data[1].map((item: string) => ({ value: item }))
        } else {
          console.error('Google搜索建议数据格式错误:', data)
          // 使用默认建议
          suggestionOptions.value = getDefaultSuggestions(keyword)
        }
        resolve()
      } catch (error) {
        console.error('处理Google搜索建议失败:', error)
        // 使用默认建议
        suggestionOptions.value = getDefaultSuggestions(keyword)
        resolve() // 即使出错也继续，避免阻塞
      }
    }

    // 替换Google搜索建议API的回调参数
    script.src = apiUrl.replace(/jsonp=(callback|google_jsonp_callback_\d+)/, `jsonp=${callbackName}`)
    script.onerror = () => {
      document.body.removeChild(script)
      delete (window as any)[callbackName]
      console.error('Google搜索建议JSONP请求失败')
      // 使用默认建议
      suggestionOptions.value = getDefaultSuggestions(keyword)
      resolve() // 即使出错也继续
    }

    document.body.appendChild(script)
  })
}

// 获取Bing搜索建议（JSONP处理）
const fetchBingSuggestions = (apiUrl: string, keyword: string) => {
  return new Promise<void>((resolve, reject) => {
    // 创建script标签发送JSONP请求
    const script = document.createElement('script')
    const callbackName = 'bing_jsonp_callback_' + Math.round(100000 * Math.random())

    // 定义全局回调函数
    ;(window as any)[callbackName] = function(data: any) {
      try {
        // 清理
        document.body.removeChild(script)
        delete (window as any)[callbackName]

        // 处理Bing返回的数据: ["keyword", ["suggestion1", "suggestion2", ...]]
        if (data && Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
          // 确保我们只提取实际的建议字符串
          suggestionOptions.value = data[1].map((item: string) => ({ value: item }))
        } else {
          console.error('Bing搜索建议数据格式错误:', data)
          // 使用默认建议
          suggestionOptions.value = getDefaultSuggestions(keyword)
        }
        resolve()
      } catch (error) {
        console.error('处理Bing搜索建议失败:', error)
        // 使用默认建议
        suggestionOptions.value = getDefaultSuggestions(keyword)
        resolve() // 即使出错也继续，避免阻塞
      }
    }

    // 替换Bing搜索建议API的回调参数
    script.src = apiUrl.replace(/JsonCallback=(callback|bing_jsonp_callback_\d+)/, `JsonCallback=${callbackName}`)
    script.onerror = () => {
      document.body.removeChild(script)
      delete (window as any)[callbackName]
      console.error('Bing搜索建议JSONP请求失败')
      // 使用默认建议
      suggestionOptions.value = getDefaultSuggestions(keyword)
      resolve() // 即使出错也继续
    }

    document.body.appendChild(script)
  })
}


// 默认建议词（当API不可用时使用）
const getDefaultSuggestions = (keyword: string): SuggestionItem[] => {
  const defaults = [
    '天气预报',
    '最新新闻',
    '股票行情',
    '电影推荐',
    '菜谱大全',
    '旅游攻略',
    '学习资料',
    '技术文档'
  ]

  // 根据关键词过滤默认建议
  return defaults
    .filter(item => item.includes(keyword))
    .map(item => ({ value: item }))
}

const onFocus = (): void => {
  isFocused.value = true
  suggestionsVisible.value = true
  nextTick(() => {
    calculateDropdownPosition()
  })

  // 获取初始建议词
  if (searchTerm.value) {
    fetchSuggestions(searchTerm.value)
  }
}

const onBlur = (): void => {
  // 添加延迟以允许点击下拉项
  setTimeout(() => {
    isFocused.value = false
    suggestionsVisible.value = false
  }, 200)
}

// 计算下拉框位置
const calculateDropdownPosition = () => {
  if (!searchInputRef.value) return

  const inputRect = searchInputRef.value.getBoundingClientRect()
  const viewportHeight = window.innerHeight
  const spaceBelow = viewportHeight - inputRect.bottom
  const dropdownHeight = 200 // 预估高度

  // 如果下方空间不足且上方空间足够，则显示在上方
  if (spaceBelow < dropdownHeight && inputRect.top > dropdownHeight) {
    dropdownPosition.value = 'top'
  } else {
    dropdownPosition.value = 'bottom'
  }
}

function handleEngineClick() {
  // 访客模式不允许修改
  if (authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC)
    return
  searchSelectListShow.value = !searchSelectListShow.value
}

function handleEngineUpdate(engine: DeskModule.SearchBox.SearchEngine) {
  state.value.currentSearchEngine = engine
  moduleConfig.saveToCloud(moduleConfigName, state.value)
  searchSelectListShow.value = false

  // 更换搜索引擎后重新获取建议词
  if (searchTerm.value) {
    fetchSuggestions(searchTerm.value)
  }
}

function handleSearchClick() {
  const url = state.value.currentSearchEngine.url
  const keyword = searchTerm
  // 如果网址中存在 %s，则直接替换为关键字
  const fullUrl = replaceOrAppendKeywordToUrl(url, keyword.value)
  handleClearSearchTerm()
  if (state.value.newWindowOpen)
    window.open(fullUrl)
  else
    window.location.href = fullUrl
}

function handleSuggestionSelect(value: string) {
  searchTerm.value = value
  suggestionsVisible.value = false
  // 触发搜索
  nextTick(() => {
    handleSearchClick()
  })
}

function replaceOrAppendKeywordToUrl(url: string, keyword: string) {
  // 如果网址中存在 %s，则直接替换为关键字
  if (url.includes('%s'))
    return url.replace('%s', encodeURIComponent(keyword))

  // 如果网址中不存在 %s，则将关键字追加到末尾
  return url + (keyword ? `${encodeURIComponent(keyword)}` : '')
}

const handleItemSearch = () => {
  emits('itemSearch', searchTerm.value)
  // 输入时也显示建议
  suggestionsVisible.value = true
}

// 处理键盘事件
const handleKeyDown = (e: KeyboardEvent) => {
  // 只有在提示框可见且有提示词时才处理键盘事件
  if (!suggestionsVisible.value || filteredSuggestions.value.length === 0) return

  // 下箭头：选中下一项
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filteredSuggestions.value.length
  }
  // 上箭头：选中上一项
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + filteredSuggestions.value.length) % filteredSuggestions.value.length
  }
  // 回车：搜索选中项
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (selectedIndex.value >= 0 && filteredSuggestions.value.length > 0) {
      handleSuggestionSelect(filteredSuggestions.value[selectedIndex.value].value)
    } else {
      handleSearchClick()
    }
  }
  // ESC：关闭提示框
  else if (e.key === 'Escape') {
    suggestionsVisible.value = false
    selectedIndex.value = -1
  }
}

function handleClearSearchTerm() {
  searchTerm.value = ''
  emits('itemSearch', searchTerm.value)
  suggestionsVisible.value = false
  suggestionOptions.value = []
  selectedIndex.value = -1
}

onMounted(() => {
  moduleConfig.getValueByNameFromCloud<State>('deskModuleSearchBox').then(({ code, data }) => {
    if (code === 0)
      state.value = data || defaultState
    else
      state.value = defaultState
  })
})
</script>

<template>
  <div class="search-box w-full" @keydown.enter="handleSearchClick" @keydown.esc="handleClearSearchTerm">
    <div class="search-container flex rounded-2xl items-center justify-center text-white w-full relative" :style="{ background, color: textColor }" :class="{ focused: isFocused }">
      <div class="search-box-btn-engine w-[40px] flex justify-center cursor-pointer" @click="handleEngineClick">
        <NAvatar :src="state.currentSearchEngine.iconSrc" style="background-color: transparent;" :size="20" />
      </div>

      <input
        ref="searchInputRef"
        v-model="searchTerm"
        :placeholder="$t('deskModule.searchBox.inputPlaceholder')"
        @focus="onFocus"
        @blur="onBlur"
        @input="handleItemSearch"
        @keydown="handleKeyDown"
        class="search-input"
      >

      <div v-if="searchTerm !== ''" class="search-box-btn-clear w-[25px] mr-[10px] flex justify-center cursor-pointer" @click="handleClearSearchTerm">
        <SvgIcon style="width: 20px;height: 20px;" icon="line-md:close-small" />
      </div>
      <div class="search-box-btn-search w-[25px] flex justify-center cursor-pointer" @click="handleSearchClick">
        <SvgIcon style="width: 20px;height: 20px;" icon="iconamoon:search-fill" />
      </div>

      <!-- 提示词下拉框 -->
      <div
        v-if="suggestionsVisible && (filteredSuggestions.length > 0 || loadingSuggestions)"
        ref="dropdownRef"
        class="suggestions-dropdown absolute left-0 w-full rounded-xl overflow-hidden z-10 shadow-lg"
        :class="dropdownPosition === 'bottom' ? 'top-full mt-[5px]' : 'bottom-full mb-[5px]'"
        :style="{ background }"
      >
        <!-- 加载状态 -->
        <div v-if="loadingSuggestions" class="suggestion-item px-4 py-2 flex items-center" :style="{ color: textColor }">
          <span class="loading-spinner mr-2"></span>
          {{ $t('deskModule.searchBox.loading') || '加载中...' }}
        </div>

        <!-- 建议列表 -->
        <div
          v-else
          v-for="(suggestion, index) in filteredSuggestions"
          :key="index"
          class="suggestion-item px-4 py-2 cursor-pointer hover:bg-white/10 transition-colors flex items-center"
          :class="{ 'active': index === selectedIndex }"
          :style="{ color: textColor }"
          @mousedown="handleSuggestionSelect(suggestion.value)"
          @mouseenter="selectedIndex = index"
        >
          <SvgIcon icon="mdi:magnify" class="mr-2" />
          {{ suggestion.value }}
        </div>
      </div>
    </div>

    <!-- 搜索引擎选择 -->
    <div v-if="searchSelectListShow" class="w-full mt-[10px] rounded-xl p-[10px]" :style="{ background }">
      <div class="flex items-center">
        <div class="flex items-center">
          <div
            v-for="item, index in defaultSearchEngineList"
            :key="index"
            :title="item.title"
            class="w-[40px] h-[40px] mr-[10px]  cursor-pointer bg-[#ffffff] flex items-center justify-center rounded-xl"
            @click="handleEngineUpdate(item)"
          >
            <NAvatar :src="item.iconSrc" style="background-color: transparent;" :size="20" />
          </div>
        </div>
      </div>

      <div class="mt-[10px]">
        <NCheckbox v-model:checked="state.newWindowOpen" @update-checked="moduleConfig.saveToCloud(moduleConfigName, state)">
          <span :style="{ color: textColor }">
            {{ $t('deskModule.searchBox.openWithNewOpen') }}
          </span>
        </NCheckbox>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-container {
  border: 1px solid #ccc;
  transition: box-shadow 0.5s,backdrop-filter 0.5s;
  padding: 2px 10px;
  backdrop-filter:blur(2px)
}

.focused, .search-container:hover {
  box-shadow: 0px 0px 30px -5px rgba(41, 41, 41, 0.45);
  -webkit-box-shadow: 0px 0px 30px -5px rgba(0, 0, 0, 0.45);
  -moz-box-shadow: 0px 0px 30px -5px rgba(0, 0, 0, 0.45);
  backdrop-filter:blur(5px)
}

.before {
  left: 10px;
}

.after {
  right: 10px;
}

input {
  background-color: transparent;
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 10px 5px;
  border: none;
  outline: none;
  font-size: 17px;
}

.suggestions-dropdown {
  max-height: 200px;
  overflow-y: auto;
}

.loading-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 选中项高亮样式 */
.suggestion-item.active {
  background-color: rgba(255, 255, 255, 0.2) !important;
}
</style>
