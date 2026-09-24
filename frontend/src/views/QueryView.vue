<template>
  <div class="q-page" :class="{ 'started': started }">
    <div id="qbar">
      <span class="brand">
        <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
        <span class="title">智能问答</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" @click="goGraph">图谱视图</el-button>
      <el-button size="small" type="primary" plain @click="newChat()">+ 新建对话</el-button>
      <el-button size="small" :type="showHistory ? 'primary' : ''" @click="toggleHistory">
        {{ showHistory ? '收起' : '历史' }}{{ showHistory ? '' : ' (' + conversations.length + ')' }}
      </el-button>
      <label class="lbl">图谱</label>
      <el-select :model-value="ws" @change="v => ws = v" style="width:150px">
        <el-option v-for="o in wsOptions" :key="o.v" :value="o.v" :label="o.t"></el-option>
      </el-select>
      <label class="lbl">模式</label>
      <el-select v-model="mode" style="width:170px">
        <el-option v-for="m in modes" :key="m.v" :value="m.v" :label="m.t"></el-option>
      </el-select>
      <span id="qstatus">
        <span id="qdot" :class="{ok: status.ok}"></span>{{ status.text }}
      </span>
    </div>
    <div class="q-row">
      <aside class="hd-side" :class="{ open: showHistory }">
        <div class="hd-toggle" @click="toggleHistory"
          :title="showHistory ? '收起历史对话' : '展开历史对话'">
          <span class="hd-burger"><i></i><i></i><i></i></span>
          <span class="hd-toggle-label" v-if="!showHistory">会话</span>
        </div>

        <div class="hd-panel" v-show="showHistory">
          <header class="hd-head">
            <div class="hd-head-l">
              <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
              <span class="hd-title">历史对话</span>
            </div>
            <div class="hd-head-r">
              <el-button size="small" type="primary" @click="newChat()">+ 新建</el-button>
            </div>
          </header>

          <div class="hd-search">
            <el-input v-model="historyFilter" size="small" clearable placeholder="搜索对话…"></el-input>
          </div>

          <div class="hd-list" @click="cancelRename">
            <div v-if="filteredConvs.length === 0" class="hd-empty">
              <div class="hd-empty-icon">��</div>
              <div v-if="historyFilter">没有匹配「{{ historyFilter }}」的对话</div>
              <div v-else>暂无历史对话<br><span class="hd-empty-tip">点右上角「+ 新建」开始一段新对话</span></div>
            </div>
            <div v-for="c in filteredConvs" :key="c.id" class="hd-item"
              :class="{ active: c.id === currentConvId }" @click.stop="loadConv(c.id)">
              <div class="hd-item-main">
                <div v-if="renamingId === c.id" class="hd-rename-input">{{ renamingTitle }}</div>
                <div v-else class="hd-item-title" :title="c.title"
                  @dblclick.stop="startRename(c.id)">{{ c.title }}</div>
                <div class="hd-item-meta">
                  <span class="hd-time">{{ fmtTime(c.updatedAt) }}</span>
                  <span class="hd-sep">·</span>
                  <span class="hd-msg">{{ c.msgCount }} 条消息</span>
                </div>
              </div>
              <div class="hd-item-actions" @click.stop>
                <button type="button" class="hd-act-btn"
                  @click.stop="startRename(c.id)" title="重命名">X</button>
                <button type="button" class="hd-act-btn hd-act-del"
                  @click.stop="deleteConv(c.id)" title="删除">D</button>
              </div>
            </div>
          </div>

          <footer class="hd-foot">双击标题可重命名 · 保存在浏览器本地</footer>
        </div>
      </aside>

      <div class="q-body">
        <div id="qcenter" v-if="!started">
          <div class="chat-card">
            <div class="chat-head">
              <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
              <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
            </div>
            <div class="progress" v-show="showProgress">
              <div class="pbar"><span class="pfill" :style="{ width: ((stepIdx+1)/steps.length*100) + '%' }"></span></div>
              <div class="steps">
                <div class="step" v-for="(s, i) in steps" :key="i" :class="{ on: i <= stepIdx, cur: i === stepIdx }">
                  <span class="dot"></span>{{ s }}
                </div>
              </div>
            </div>
            <div class="presets-inline" v-if="messages.length === 0">
              <div class="pc-lbl">推荐问题（点击直接提问）</div>
              <div class="pc-list">
                <span class="pc-chip" v-for="p in presets" :key="p" @click="runQuery(p)">{{ p }}</span>
              </div>
            </div>
            <div class="chat-scroll" ref="chatScroll" @click="onChatClick"
              @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave">
              <div class="bubbles">
                <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
                  <div class="avatar" v-if="m.role === 'ai'">AI</div>
                  <div class="bubble" :class="m.role" v-html="m.role === 'ai' ? (m.html || waitingHtml()) : escapeHtml(m.text)"></div>
                  <div class="avatar me" v-if="m.role === 'user'">你</div>
                </div>
                <div class="bubbles-end"></div>
              </div>
            </div>
            <div class="chat-input">
              <el-input v-model="query" class="qbar-input"
                placeholder="输入问题，回车查询（Shift+Enter 换行）"
                :disabled="loading"
                @keydown.enter.exact.prevent="runQuery()"
                @keydown.shift.enter.exact="appendNewline"
                @keydown.ctrl.enter="runQuery()"></el-input>
              <el-button type="primary" :loading="loading" :disabled="loading" @click="runQuery()">查询</el-button>
            </div>
          </div>
        </div>
        <div id="qmain" v-else>
          <div id="qleft">
            <div class="chat-head sub">
              <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
              <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
            </div>
            <div class="progress" v-show="showProgress || loading">
              <div class="pbar"><span class="pfill" :style="{ width: ((stepIdx+1)/steps.length*100) + '%' }"></span></div>
              <div class="steps">
                <div class="step" v-for="(s, i) in steps" :key="i" :class="{ on: i <= stepIdx, cur: i === stepIdx }">
                  <span class="dot"></span>{{ s }}
                </div>
              </div>
            </div>
            <div class="chat-scroll" ref="chatScroll2" @click="onChatClick"
              @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave">
              <div class="bubbles">
                <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
                  <div class="avatar" v-if="m.role === 'ai'">AI</div>
                  <div class="bubble" :class="m.role" v-html="m.role === 'ai' ? (m.html || waitingHtml()) : escapeHtml(m.text)"></div>
                  <div class="avatar me" v-if="m.role === 'user'">你</div>
                </div>
                <div class="bubbles-end"></div>
              </div>
            </div>
            <div class="chat-input">
              <el-input v-model="query" class="qbar-input"
                placeholder="继续提问，回车查询（Shift+Enter 换行）"
                :disabled="loading"
                @keydown.enter.exact.prevent="runQuery()"
                @keydown.shift.enter.exact="appendNewline"
                @keydown.ctrl.enter="runQuery()"></el-input>
              <el-button type="primary" :loading="loading" :disabled="loading" @click="runQuery()">查询</el-button>
            </div>
          </div>
          <div id="qright">
            <div class="grow-overlay" v-if="loading && entities.length === 0">
              <div class="grow-card">
                <div class="grow-spin"></div>
                <div class="grow-title">子图生长中…</div>
                <div class="grow-step">{{ steps[stepIdx] }}</div>
                <div class="grow-hint">正在把找到的内容整理成关系图谱</div>
              </div>
            </div>
            <div class="rh">走过的子图</div>
            <div id="qnet"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const started = ref(false);
const currentMeta = { color: '#fff', badge: '问' };
const showHistory = ref(false);
const conversations = ref([]);
const ws = ref('g00');
const wsOptions = [{ v: 'g00', t: '总' }];
const mode = ref('mix');
const modes = [{ v: 'mix', t: 'mix' }];
const status = { ok: false, text: '' };
const filteredConvs = ref([]);
const historyFilter = ref('');
const renamingId = ref(null);
const renamingTitle = ref('');
const currentConvId = ref(null);
function goHome() {}
function goGraph() {}
function newChat() {}
function toggleHistory() {}
function cancelRename() {}
function loadConv() {}
function startRename() {}
function deleteConv() {}
function fmtTime() { return ''; }
</script>
