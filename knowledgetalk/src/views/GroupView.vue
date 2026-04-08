<template>
  <section>
    <!-- 방 생성, 방 입장 / 화면 공유, 종료 버튼 -->
    <div id="roomButton">
      <input id="roomIdInput" v-model="roomId" type="text" placeholder="room id" />

      <button :disabled="!ready || creating || joined" @click="createVideoRoom">
        CreateVideoRoom
      </button>
      <button :disabled="!ready || joining || joined" @click="joinRoom()">
        JoinRoom
      </button>

      <button :disabled="!ready || !joined || sharing" @click="startScreenShare">
        화면 공유
      </button>
      <button :disabled="!ready || !joined || !sharing" @click="stopScreenShare">
        공유 종료
      </button>
    </div>

    <!-- 웹캠 화면 , 화면 공유 화면 -->
    <div id="videoBox">
      <div v-for="id in peerIds" :key="id" class="multiVideo">
        <p class="userLabel">{{ id }}</p>

        <div class="videoRow">
          <div class="videoCol">
            <p class="subLabel">CAM</p>
            <video :id="`camVideo-${id}`" autoplay playsinline></video>
          </div>

          <div class="videoCol">
            <p class="subLabel">SCREEN</p>
            <video :id="`screenVideo-${id}`" autoplay playsinline></video>
          </div>
        </div>
      </div>
    </div>

    <!-- 채팅창 화면 -->
    <div v-if="joined" id="chatBox">
      <div class="chatList" ref="chatListEl">
        <div style="font-family: Arial, Helvetica, sans-serif;">CHATBOX</div>

        <div
          v-for="(m, i) in chatMessages"
          :key="i"
          class="chatItem"
          :class="{ mine: m.mine }"
        >
          <div class="chatMeta">{{ m.user }}</div>
          <div class="chatBubble">{{ m.message }}</div>
        </div>
      </div>

      <div class="chatInputRow">
        <input
          class="chatInput"
          v-model="chatMessage"
          type="text"
          placeholder="메시지를 입력하고 Enter로 전송"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
          @keydown.enter.prevent="onEnterSend"
        />
      </div>
    </div>

    <!-- 주요 시스템 로그 출력 -->
    <div id="printBox">
      <p v-for="(l, i) in logs" :key="i">[{{ l.type }}] {{ l.text }}</p>
    </div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, nextTick } from "vue";

// KnowledgeTalk SDK 로드 객체 생성
function createKT() {
  const Con = new Knowledgetalk();
  if (!Con) throw new Error("Knowledgetalk SDK 로딩 안됨");
  return Con;
}

// KnowledgeTalk SDK 코드, 키값 (따로 발급)
const cpCode = import.meta.env.VITE_API_KEY;
const authKey = import.meta.env.VITE_CPCODE;
  
// 상수 상태관리
const roomId = ref("");
const ready = ref(false);
const joined = ref(false);
const creating = ref(false);
const joining = ref(false);
const sharing = ref(false);

const peerIds = ref([]); // 화면에 카드를 만들기 위한 ID 리스트
const logs = ref([]); // 로그

let kt = null; // Knowledgetalk SDK 객체를 담을 변수
let presenceHandler = null;

let localCamStream = null;
let localScreenStream = null;

let publishedCamOnce = false; // 자신의 캠은 한번만 선언

// Group: feeds 기반 subscribeVideo 중복 방지 -> cam / screen 나누기 위해
const subscribed = new Set();

// 채팅 관련 상수
const chatMessage = ref("");
const chatMessages = ref([]);
const chatListEl = ref(null);
const isComposing = ref(false); // IME 조합 체크

const pushLog = (type, obj) => {
  const text = JSON.stringify(obj);
  logs.value.push({ type, text });
};

const ensurePeer = (id) => {
  if (!id) return;
  if (!peerIds.value.includes(id)) peerIds.value.push(id);
};

const removePeer = (id) => {
  peerIds.value = peerIds.value.filter((x) => x !== id);
  subscribed.delete(`cam:${id}`);
  subscribed.delete(`screen:${id}`);
};

const getVideoEl = (kind, id) => document.getElementById(`${kind}Video-${id}`);

const setStream = async (kind, id, stream) => {
  ensurePeer(id);
  await nextTick();

  const el = getVideoEl(kind, id);
  if (!el) return;

  if (el.srcObject === stream) return;
  el.srcObject = null;
  el.srcObject = stream;
};

const clearStream = async (kind, id) => {
  await nextTick();
  const el = getVideoEl(kind, id);
  if (el) el.srcObject = null;
};

const scrollChatToBottom = async () => {
  await nextTick();
  const el = chatListEl.value;
  if (el) el.scrollTop = el.scrollHeight;
};

const onEnterSend = () => {
  if (isComposing.value) return;
  sendChat();
};

const sendChat = async () => {
  const msg = (chatMessage.value || "").trim();
  if (!msg || !joined.value) return;

  const rid = kt?.getRoomId?.() || roomId.value.trim();
  if (!rid) return;

  const res = await kt.chat(msg, rid);
  if (res?.code !== "200") return alert("chat failed!");

  const me = kt.getUserId();
  chatMessages.value.push({ user: me, message: msg, mine: true });
  chatMessage.value = "";
  await scrollChatToBottom();
};

const handleChatEvent = async (msg) => {
  const sender = msg.user;
  const text = msg.message;
  const me = kt?.getUserId?.();

  if (sender === me) return;

  chatMessages.value.push({ user: sender, message: text, mine: false });
  await scrollChatToBottom();
};

// startLocalCamIfNeeded -> 로컬 스트림 확보
const startLocalCamIfNeeded = async () => {
  if (localCamStream) return localCamStream;

  localCamStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 380 },
    audio: false,
  });

  const me = kt.getUserId();
  await setStream("cam", me, localCamStream);
  return localCamStream;
};

// publishVideo -> 캠 송출 / 수신
const publishMyCamIfNeeded = async () => {
  if (!joined.value || publishedCamOnce) return;

  await startLocalCamIfNeeded();
  const ok = await kt.publishVideo("cam", localCamStream);
  if (!ok) return alert("publishVideo(cam) failed!");

  publishedCamOnce = true;
};

// feeds의 cam/screen을 subscribeVideo로 받아서 할당함
const subscribeFeed = async (feed) => {
  if (!feed?.id || !feed?.type) return;

  const key = `${feed.type}:${feed.id}`;
  if (subscribed.has(key)) return;
  subscribed.add(key);

  try {
    const stream = await kt.subscribeVideo(feed.id, feed.type);
    await setStream(feed.type, feed.id, stream);
  } catch (e) {
    subscribed.delete(key);
    console.error("subscribeVideo failed", feed, e);
  }
};

onMounted(async () => {
  try {
    kt = createKT();

    const initRes = await kt.init(cpCode, authKey);
    if (initRes.code !== "200") return alert("init failed!");
    ready.value = true;

    // 각 이벤트 발생 처리 함수
    presenceHandler = async (event) => {
      const msg = event.detail;
      pushLog("receive", msg);

      switch (msg.type) {
        case "join": {
          const uid = msg?.user?.id || msg?.user?.userId || msg?.user;
          if (uid) ensurePeer(uid);
          break;
        }

        case "leave": {
          const uid =
            typeof msg.user === "string"
              ? msg.user
              : msg?.user?.id || msg?.user?.userId;

          if (!uid) break;

          removePeer(uid);
          await clearStream("screen", uid);
          break;
        }

        case "publish": {
          const feeds = msg.feeds || [];
          for (const feed of feeds) {
            if (feed?.id) ensurePeer(feed.id);
            await subscribeFeed(feed);
          }
          break;
        }

        case "shareStop": {
          const sender = msg.sender || msg.user;
          if (!sender) break;

          subscribed.delete(`screen:${sender}`);
          await clearStream("screen", sender);
          break;
        }

        case "chat": {
          await handleChatEvent(msg);
          break;
        }

        default:
          break;
      }
    };

    kt.addEventListener("presence", presenceHandler);
  } catch (e) {
    console.error(e);
    alert(String(e?.message || e));
  }
});

// 페이지가 종료될 때 실행
const stopStream = (s) => {
  if (!s) return null;
  try {
    s.getTracks().forEach((t) => t.stop());
  } catch {}
  return null;
};

onBeforeUnmount(() => {
  try {
    if (kt && presenceHandler) kt.removeEventListener("presence", presenceHandler);
  } catch {}

  localCamStream = stopStream(localCamStream);
  localScreenStream = stopStream(localScreenStream);
});

// 방 생성, 방 입장 SDK 객체
const createVideoRoom = async () => {
  creating.value = true;
  try {
    const res = await kt.createVideoRoom();
    if (res.code !== "200") return alert("createVideoRoom failed!");
    roomId.value = res.roomId;
    await joinRoom(res.roomId);
  } finally {
    creating.value = false;
  }
};

const joinRoom = async (overrideRoomId) => {
  let rid =
    typeof overrideRoomId === "string" ? overrideRoomId.trim() : roomId.value.trim();

  if (!rid) {
    const input = prompt("입장할 roomId를 입력하세요.");
    if (!input) return;
    rid = input.trim();
    roomId.value = rid;
  }

  joining.value = true;
  try {
    const roomData = await kt.joinRoom(rid);
    if (roomData.code !== "200") return alert("joinRoom failed!");

    joined.value = true;

    ensurePeer(kt.getUserId());
    await publishMyCamIfNeeded();

    const members = roomData.members || {};
    for (const memberId in members) ensurePeer(memberId);
  } finally {
    joining.value = false;
  }
};

const startScreenShare = async () => {
  try {
    sharing.value = true;

    await kt.shareStop().catch(() => {});

    if (localScreenStream) {
      localScreenStream.getTracks().forEach((t) => t.stop());
      localScreenStream = null;
    }

    localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const [track] = localScreenStream.getVideoTracks();
    if (track) track.onended = () => stopScreenShare();

    const me = kt.getUserId();
    await setStream("screen", me, localScreenStream);

    const res = await kt.screenStart(localScreenStream, undefined);
    if (res?.code !== "200") {
      sharing.value = false;
      alert("screenStart failed!");
    }
  } catch (e) {
    console.error(e);
    sharing.value = false;
    alert(String(e?.message || e));
  }
};

const stopScreenShare = async () => {
  sharing.value = false;

  await kt.shareStop().catch(() => {});

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
  }

  const me = kt?.getUserId?.();
  if (me) {
    subscribed.delete(`screen:${me}`);
    await clearStream("screen", me);
  }
};
</script>

<style>
/* 방 생성, 방 입장 CSS */
#roomIdInput {
  padding: 10px;
  width: 220px;
  margin: 5px;
  border: 2px darkslategray solid;
  border-radius: 10px;
}
#roomButton {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 카메라, 화면 공유 CSS */
#videoBox {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.multiVideo {
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 10px;
}
.userLabel {
  margin: 0 0 8px;
  font-weight: 700;
}
.videoRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.videoCol {
  position: relative;
  overflow: hidden;
}
.subLabel {
  margin: 0 0 6px;
  font-size: 12px;
  opacity: 0.8;
}
#videoBox video {
  display: block;
  width: 100%;
  border-radius: 10px;
  background: #000;
}
video[id^="screenVideo-"] {
  height: 320px;
  max-height: 320px;
  object-fit: contain;
}

/* 채팅방 CSS */
#chatBox {
  margin-top: 14px;
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 10px;
  width: 500px;
}
.chatList {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
}
.chatItem {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.chatItem.mine {
  align-items: flex-end;
}
.chatMeta {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 2px;
}
.chatBubble {
  background: #f3f3f3;
  border-radius: 10px;
  padding: 8px 10px;
  max-width: 85%;
  white-space: pre-wrap;
  word-break: break-word;
}
.chatItem.mine .chatBubble {
  background: #e9f3ff;
}
.chatInputRow {
  margin-top: 10px;
  display: flex;
}
.chatInput {
  width: min(900px, 100%);
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 10px;
}
</style>
