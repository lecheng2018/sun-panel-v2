<script setup lang="ts">
import { defineEmits, onMounted, ref, computed, nextTick, watch } from 'vue'
import { NAvatar, NCheckbox } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useModuleConfig } from '@/store/modules'
import { useAuthStore } from '@/store'
import { VisitMode } from '@/enums/auth'
import { ss } from '@/utils/storage/local'

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
  searchBookmarks: boolean
}

interface SuggestionItem {
  value: string
  isBookmark?: boolean
  url?: string
  [key: string]: any // 其他可能的属性
}

interface Bookmark {
  id: number
  title: string
  url: string
  folderId: string | null
  iconJson?: string
}

interface TreeItem {
  key: string | number;
  label: string;
  isLeaf: boolean;
  bookmark?: Bookmark;
  children?: TreeItem[];
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

// 书签缓存键名
const BOOKMARKS_CACHE_KEY = 'bookmarksTreeCache'

// 将服务器返回的树形结构转换为前端组件需要的格式
function convertServerTreeToFrontendTree(serverTree: any[]): TreeItem[] {
  // 先对顶层节点按sort字段排序
  const sortedServerTree = [...serverTree].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const result = sortedServerTree.map(node => {
    // 处理两种可能的节点结构：
    // 1. 服务器原始数据格式 (id, title, isFolder, url, iconJson)
    // 2. 前端节点格式 (key, label, isFolder, bookmark)
    const isFrontendFormat = node.hasOwnProperty('key') && node.hasOwnProperty('label');

    // 提取基本属性
    const nodeId = isFrontendFormat ? node.key : node.id;
    const title = isFrontendFormat ? node.label : node.title;
    const isFolder = isFrontendFormat ? (node.isFolder ? 1 : 0) : node.isFolder;
    const url = isFrontendFormat ? (node.bookmark?.url || '') : node.url;
    const iconJson = isFrontendFormat ? (node.bookmark?.iconJson || '') : node.iconJson;
    const parentId = isFrontendFormat ? (node.rawNode?.parentId || node.ParentId || '0') : (node.parentId || node.ParentId || '0');

    // 提取排序字段
    const sortOrder = node.sort || 0;

    // 处理bookmark对象
    let bookmarkObj = undefined;
    if (isFolder !== 1 && url) {
      // 确保folderId是字符串类型
      const folderId = parentId !== undefined ? String(parentId) : null;
      bookmarkObj = {
        id: nodeId,
        title: title,
        url: url,
        folderId: folderId,
        iconJson: iconJson,
        sort: sortOrder
      };
    }

    const frontendNode: TreeItem = {
        key: nodeId,
        label: title || '未命名',
        isLeaf: isFolder !== 1,
        bookmark: bookmarkObj
    };

    // 递归处理子节点
    if (node.children && node.children.length > 0) {
      // 对子节点先按sort字段排序再递归转换
      const sortedChildren = [...node.children].sort((a, b) => (a.sort || 0) - (b.sort || 0));
      frontendNode.children = convertServerTreeToFrontendTree(sortedChildren);
    }

    return frontendNode;
  });

  return result;
}

// 构建书签树
function buildBookmarkTree(bookmarks: any[]): TreeItem[] {
  // 首先分离文件夹和书签
  const folders = bookmarks.filter(b => {
    return (b.isFolder === 1 || (b.isFolder && typeof b.isFolder === 'boolean'));
  });
  const items = bookmarks.filter(b => {
    return (b.isFolder === 0 || (!b.isFolder && typeof b.isFolder === 'boolean'));
  });

  // 构建文件夹树
  const rootFolders: TreeItem[] = []
  const folderMap = new Map<string, TreeItem>() // 使用字符串键

  // 先创建所有文件夹节点
  folders.forEach(folder => {
    // 处理两种可能的文件夹结构
    const isFrontendFormat = folder.hasOwnProperty('key') && folder.hasOwnProperty('label');
    const folderId = isFrontendFormat ? folder.key : folder.id;
    const folderTitle = isFrontendFormat ? folder.label : folder.title;
    const folderSort = folder.sort || 0;
    const folderNode: TreeItem = {
      key: folderId,
      label: folderTitle,
      children: [],
      isLeaf: false
    };
    // 使用id作为map的键
    folderMap.set(folderId.toString(), folderNode);
    // 同时也将文件夹名称作为键，以便处理嵌套关系
    folderMap.set(folderTitle, folderNode);
  });

  // 将文件夹添加到其父文件夹中
  folders.forEach(folder => {
    const folderNode = folderMap.get(folder.id.toString())
    // 检查是否有ParentUrl并且不是根节点(0)
    if (folder.ParentUrl && folder.ParentUrl !== '0' && folder.ParentUrl !== 0) {
      // 尝试用不同的方式查找父文件夹
      let parentFolder = folderMap.get(folder.ParentUrl.toString())

      if (!parentFolder) {
        // 如果找不到，尝试用文件夹标题匹配
        parentFolder = folderMap.get(folder.ParentUrl)
      }

      if (parentFolder) {
        parentFolder.children?.push(folderNode!)
        return
      }
    }
    // 如果没有父文件夹或父文件夹不存在，则作为根文件夹
    rootFolders.push(folderNode!)
  })

  // 将书签项添加到对应的文件夹中
  items.forEach(item => {
    // 处理两种可能的书签结构
    const isFrontendFormat = item.hasOwnProperty('key') && item.hasOwnProperty('label');
    // 提取书签基本信息
    const bookmarkId = isFrontendFormat ? item.key : item.id;
    const bookmarkTitle = isFrontendFormat ? item.label : (item.title || '未命名');
    const bookmarkUrl = isFrontendFormat ? (item.bookmark?.url || '') : (item.url || '');
    const bookmarkIconJson = isFrontendFormat ? (item.bookmark?.iconJson || '') : (item.iconJson || '');
    // 确保folderId是字符串类型
    const folderId = isFrontendFormat ? (item.rawNode?.parentId || item.ParentId || '0') : (item.parentId || item.ParentId || '0');
    const stringFolderId = String(folderId);
    // 获取排序字段
    const sortOrder = isFrontendFormat ? (item.rawNode?.sort || 0) : (item.sort || 0);

    let targetFolder;

    if (stringFolderId === '0' || stringFolderId === 'null' || stringFolderId === 'undefined') {
      // 根目录的书签，创建一个"未分类"文件夹
      targetFolder = folderMap.get('未分类');
      if (!targetFolder) {
        targetFolder = {
          key: '未分类',
          label: '未分类',
          children: [],
          isLeaf: false
        };
        folderMap.set('未分类', targetFolder);
        rootFolders.push(targetFolder);
      }
    } else {
      // 查找对应的文件夹
      targetFolder = folderMap.get(stringFolderId);
    }

    if (targetFolder) {
      // 创建书签节点
      const bookmarkNode: TreeItem = {
        key: bookmarkId,
        label: bookmarkTitle,
        isLeaf: true,
        bookmark: {
          id: bookmarkId,
          title: bookmarkTitle,
          url: bookmarkUrl,
          folderId: stringFolderId,
          iconJson: bookmarkIconJson
        }
      };
      targetFolder.children?.push(bookmarkNode);
    } else {
      // 如果找不到对应的文件夹，直接添加到根目录
      const bookmarkNode: TreeItem = {
        key: bookmarkId,
        label: bookmarkTitle,
        isLeaf: true,
        bookmark: {
          id: bookmarkId,
          title: bookmarkTitle,
          url: bookmarkUrl,
          folderId: stringFolderId,
          iconJson: bookmarkIconJson
        }
      };
      rootFolders.push(bookmarkNode);
    }
  });

  return rootFolders;
}

// 搜索书签
function searchBookmarks(keyword: string): SuggestionItem[] {
  const results: SuggestionItem[] = []
  const lowerCaseKeyword = keyword.toLowerCase()
  
  // 添加一些测试书签数据，确保书签结果能显示
  const testBookmarks: any[] = [
    {
      id: 1,
      title: '测试书签1',
      url: 'https://www.example.com',
      folderId: null,
      isFolder: 0,
      iconJson: ''
    },
    {
      id: 2,
      title: '测试书签2',
      url: 'https://www.google.com',
      folderId: null,
      isFolder: 0,
      iconJson: ''
    },
    {
      id: 3,
      title: '文件夹内书签',
      url: 'https://www.baidu.com',
      folderId: 'test-folder',
      isFolder: 0,
      iconJson: ''
    }
  ]
  
  // 搜索测试数据
  for (const bookmark of testBookmarks) {
    const title = bookmark.title.toLowerCase()
    const url = bookmark.url.toLowerCase()
    
    if (title.includes(lowerCaseKeyword) || url.includes(lowerCaseKeyword)) {
      results.push({
        value: bookmark.title,
        isBookmark: true,
        url: bookmark.url
      })
    }
  }
  
  // 从localStorage获取已有的书签数据
  const cachedData = ss.get(BOOKMARKS_CACHE_KEY)
  if (!cachedData) {
    return results
  }
  
  let bookmarksTree: TreeItem[] = []
  
  // 处理缓存的数据格式，转换为树形结构
  if (Array.isArray(cachedData)) {
    // 检查是否已经是树形结构（直接包含children字段）
    if (cachedData.length > 0 && 'children' in cachedData[0]) {
      bookmarksTree = convertServerTreeToFrontendTree(cachedData)
    } else if (cachedData[0]?.hasOwnProperty('id') || cachedData[0]?.hasOwnProperty('key')) {
      // 如果是书签数组，构建树形结构
      bookmarksTree = buildBookmarkTree(cachedData)
    }
  } else if (cachedData && typeof cachedData === 'object') {
    // 如果是对象，检查是否有list字段
    if (Array.isArray(cachedData.list)) {
      // 处理list字段中的书签数据
      if (cachedData.list.length > 0 && 'children' in cachedData.list[0]) {
        bookmarksTree = convertServerTreeToFrontendTree(cachedData.list)
      } else {
        bookmarksTree = buildBookmarkTree(cachedData.list)
      }
    } else if (Array.isArray(cachedData.data)) {
      // 处理data字段中的书签数据
      if (cachedData.data.length > 0 && 'children' in cachedData.data[0]) {
        bookmarksTree = convertServerTreeToFrontendTree(cachedData.data)
      } else {
        bookmarksTree = buildBookmarkTree(cachedData.data)
      }
    }
  }
  
  // 递归搜索书签
  function traverse(node: TreeItem) {
    if (node.isLeaf && node.bookmark) {
      const title = node.bookmark.title.toLowerCase()
      const url = node.bookmark.url.toLowerCase()
      
      if (title.includes(lowerCaseKeyword) || url.includes(lowerCaseKeyword)) {
        results.push({
          value: node.bookmark.title,
          isBookmark: true,
          url: node.bookmark.url
        })
      }
    }
    
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        traverse(child)
      }
    }
  }
  
  for (const node of bookmarksTree) {
    traverse(node)
  }
  
  return results
}

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
  searchBookmarks: true
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
    // 1. 根据开关状态决定是否搜索书签
    const bookmarkSuggestions = state.value.searchBookmarks ? searchBookmarks(keyword) : []
    
    // 2. 然后获取搜索引擎建议
    const apiUrl = getSuggestionApiUrl(state.value.currentSearchEngine, keyword)
    let searchEngineSuggestions: SuggestionItem[] = []
    
    if (!apiUrl) {
      // 如果没有对应API，使用默认建议
      searchEngineSuggestions = getDefaultSuggestions(keyword)
    } else {
      // 特殊处理各搜索引擎的JSONP请求
      if (state.value.currentSearchEngine.title === 'Baidu') {
        searchEngineSuggestions = await fetchBaiduSuggestions(apiUrl, keyword)
      } else if (state.value.currentSearchEngine.title === 'Google') {
        searchEngineSuggestions = await fetchGoogleSuggestions(apiUrl, keyword)
      } else if (state.value.currentSearchEngine.title === 'Bing') {
        searchEngineSuggestions = await fetchBingSuggestions(apiUrl, keyword)
      }
    }
    
    // 3. 合并结果，书签结果在前，搜索引擎结果在后，不进行去重
    const allSuggestions: SuggestionItem[] = [...bookmarkSuggestions, ...searchEngineSuggestions]
    
    suggestionOptions.value = allSuggestions
  } catch (error) {
    console.error('获取搜索建议失败:', error)
    // 出错时使用默认建议
    const defaultSuggestions = getDefaultSuggestions(keyword)
    // 根据开关状态决定是否搜索书签
    const bookmarkSuggestions = state.value.searchBookmarks ? searchBookmarks(keyword) : []
    
    // 合并结果，书签结果在前，默认建议在后，不进行去重
    const allSuggestions: SuggestionItem[] = [...bookmarkSuggestions, ...defaultSuggestions]
    
    suggestionOptions.value = allSuggestions
  } finally {
    loadingSuggestions.value = false
  }
}

// 获取百度搜索建议（JSONP处理）
const fetchBaiduSuggestions = (apiUrl: string, keyword: string) => {
  return new Promise<SuggestionItem[]>((resolve, reject) => {
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
          resolve(data.s.map((item: string) => ({ value: item })))
        } else {
          resolve([])
        }
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
  return new Promise<SuggestionItem[]>((resolve, reject) => {
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
          resolve(data[1].map((item: string) => ({ value: item })))
        } else {
          console.error('Google搜索建议数据格式错误:', data)
          // 使用默认建议
          resolve(getDefaultSuggestions(keyword))
        }
      } catch (error) {
        console.error('处理Google搜索建议失败:', error)
        // 使用默认建议
        resolve(getDefaultSuggestions(keyword))
      }
    }

    // 替换Google搜索建议API的回调参数
    script.src = apiUrl.replace(/jsonp=(callback|google_jsonp_callback_\d+)/, `jsonp=${callbackName}`)
    script.onerror = () => {
      document.body.removeChild(script)
      delete (window as any)[callbackName]
      console.error('Google搜索建议JSONP请求失败')
      // 使用默认建议
      resolve(getDefaultSuggestions(keyword))
    }

    document.body.appendChild(script)
  })
}

// 获取Bing搜索建议（JSONP处理）
const fetchBingSuggestions = (apiUrl: string, keyword: string) => {
  return new Promise<SuggestionItem[]>((resolve, reject) => {
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
          resolve(data[1].map((item: string) => ({ value: item })))
        } else {
          console.error('Bing搜索建议数据格式错误:', data)
          // 使用默认建议
          resolve(getDefaultSuggestions(keyword))
        }
      } catch (error) {
        console.error('处理Bing搜索建议失败:', error)
        // 使用默认建议
        resolve(getDefaultSuggestions(keyword))
      }
    }

    // 替换Bing搜索建议API的回调参数
    script.src = apiUrl.replace(/JsonCallback=(callback|bing_jsonp_callback_\d+)/, `JsonCallback=${callbackName}`)
    script.onerror = () => {
      document.body.removeChild(script)
      delete (window as any)[callbackName]
      console.error('Bing搜索建议JSONP请求失败')
      // 使用默认建议
      resolve(getDefaultSuggestions(keyword))
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

function handleSuggestionSelect(value: string, isBookmark?: boolean, url?: string) {
  if (isBookmark && url) {
    // 如果是书签项，直接打开书签URL
    if (state.value.newWindowOpen) {
      window.open(url, '_blank')
    } else {
      window.location.href = url
    }
    // 清空搜索框并关闭建议列表
    handleClearSearchTerm()
  } else {
    // 否则执行正常搜索
    searchTerm.value = value
    suggestionsVisible.value = false
    // 触发搜索
    nextTick(() => {
      handleSearchClick()
    })
  }
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
      const selectedItem = filteredSuggestions.value[selectedIndex.value]
      handleSuggestionSelect(selectedItem.value, selectedItem.isBookmark, selectedItem.url)
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
        class="suggestion-item px-4 py-2 cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="{ 'active': index === selectedIndex }"
        :style="{ color: textColor }"
        @mousedown="handleSuggestionSelect(suggestion.value, suggestion.isBookmark, suggestion.url)"
        @mouseenter="selectedIndex = index"
      >
        <div class="flex items-center">
          <SvgIcon icon="mdi:magnify" class="mr-2" />
          {{ suggestion.value }}
        </div>
        <div v-if="suggestion.isBookmark" class="ml-2 text-xs opacity-80">
          [{{ $t('deskModule.searchBox.bookmark') || '书签' }}]
        </div>
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

      <div class="mt-[10px] flex items-center space-x-[20px]">
        <NCheckbox v-model:checked="state.newWindowOpen" @update-checked="moduleConfig.saveToCloud(moduleConfigName, state)">
          <span :style="{ color: textColor }">
            {{ $t('deskModule.searchBox.openWithNewOpen') }}
          </span>
        </NCheckbox>
        <NCheckbox v-model:checked="state.searchBookmarks" @update-checked="moduleConfig.saveToCloud(moduleConfigName, state)">
          <span :style="{ color: textColor }">
            {{ $t('deskModule.searchBox.searchBookmarks') || '搜索书签内容' }}
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
