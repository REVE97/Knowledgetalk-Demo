<template>
  <section>
    <!-- 방 생성, 방 입장 / 화면 공유, 종료 버튼 -->
    <div id="roomButton">
      <input id="roomIdInput" v-model="roomId" type="text" placeholder="room id" />

      <button :disabled="!ready || creating || joined" @click="createRoom">CreateRoom</button>
      <button :disabled="!ready || joining || joined" @click="joinRoom()">JoinRoom</button>

      <button :disabled="!ready || !joined || sharing" @click="startScreenShare">화면 공유</button>
      <button :disabled="!ready || !joined || !sharing" @click="stopScreenShare">공유 종료</button>
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
let presenceHandler = null; // 이벤트 발생 함수를 담을 변수

let localCamStream = null; // 카메라 웹캠 스트림 변수
let localScreenStream = null; // 화면 공유 스트림 변수

// 중복 방지 상수
const publishedCamTargets = new Set(); // 이미 카메라 publish 된 사용자 중복 방지
const screenTargets = new Set(); // 이미 화면 공유된 사용자 중복 방지

// 채팅 관련 상수
const chatMessage = ref("");
const chatMessages = ref([]);
const chatListEl = ref(null);
const isComposing = ref(false); // IME 조합 체크

// log 에 기록
const pushLog = (type, obj) => {
  const text = JSON.stringify(obj);
  logs.value.push({ type, text });
};

// peerid 에 없으면 추가
const ensurePeer = (id) => {
  if (!id) return;
  if (!peerIds.value.includes(id)) peerIds.value.push(id);
};

// peerid 에서 제거
const removePeer = (id) => {
  peerIds.value = peerIds.value.filter((x) => x !== id);
  publishedCamTargets.delete(id);
  screenTargets.delete(id);
};

// CAM/SCREEN Video DOM 찾기
const getVideoEl = (kind, id) => document.getElementById(`${kind}Video-${id}`);

// 스트림 설정
const setStream = async (kind, id, stream) => {
  ensurePeer(id);
  await nextTick();

  const el = getVideoEl(kind, id);
  if (!el) return;

  if (el.srcObject === stream) return;
  el.srcObject = null;
  el.srcObject = stream;
};

// 스트림 제거
const clearStream = async (kind, id) => {
  await nextTick();
  const el = getVideoEl(kind, id);
  if (el) el.srcObject = null;
};

// 채팅창이 항상 아래로 배치
const scrollChatToBottom = async () => {
  await nextTick();
  const el = chatListEl.value;
  if (el) el.scrollTop = el.scrollHeight;
};

// 엔터키로 채팅 내용 전송
const onEnterSend = () => {
  if (isComposing.value) return;
  sendChat();
};

// 채팅창에 채팅 내용 전송
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

// 내 화면에도 채팅 내용 추가
const handleChatEvent = async (msg) => {
  const sender = msg.user;
  const text = msg.message;
  const me = kt?.getUserId?.();

  if (sender === me) return;

  chatMessages.value.push({ user: sender, message: text, mine: false });
  await scrollChatToBottom();
};

// 로컬 카메라 스트림 확보
const startLocalCamIfNeeded = async () => {
  if (localCamStream) return localCamStream;

  localCamStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  const me = kt.getUserId();
  await setStream("cam", me, localCamStream);
  return localCamStream;
};

// publishP2P -> 캠 송출 / 수신
const publishCamTo = async (targetId) => {
  const me = kt.getUserId();
  if (!joined.value || !targetId || targetId === me) return;
  if (publishedCamTargets.has(targetId)) return;

  await startLocalCamIfNeeded();
  await kt.publishP2P(targetId, "cam", localCamStream);
  publishedCamTargets.add(targetId);
};

// 캠 송출 반복
const publishCamToAllInRoom = async (roomData) => {
  const me = kt.getUserId();
  const members = roomData?.members || {};
  for (const id in members) {
    if (id !== me) await publishCamTo(id);
  }
};

// 로컬 화면 스트림 확보
const startScreenStreamIfNeeded = async () => {
  if (localScreenStream) return localScreenStream;

  localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const [track] = localScreenStream.getVideoTracks();
  if (track) track.onended = () => stopScreenShare();

  const me = kt.getUserId();
  await setStream("screen", me, localScreenStream);
  return localScreenStream;
};

// 공유 화면 송출 시작
const screenStartTo = async (targetId) => {
  const me = kt.getUserId();
  if (!joined.value || !targetId || targetId === me) return;
  if (screenTargets.has(targetId)) return;

  const stream = await startScreenStreamIfNeeded();

  const res = await kt.screenStart(stream, targetId);
  if (res?.code !== "200") return alert("screenStart failed!");

  screenTargets.add(targetId);
};

const screenStartToAll = async () => {
  const me = kt.getUserId();
  for (const id of peerIds.value) {
    if (id !== me) await screenStartTo(id);
  }
};

// Mount 시에 실행되는 함수
onMounted(async () => {
  try {
    kt = createKT();

    // SDK의 Code 와 인증 키 값을 받아 초기화 -> SDK 정상적으로 작동하면 ready = true
    const initRes = await kt.init(cpCode, authKey);

    if (initRes.code !== "200") return alert("init failed!");

    ready.value = true;
  
    // 각 이벤트 발생 처리 함수
    presenceHandler = async (e) => {
      const msg = e.detail;
      pushLog("receive", msg);

      switch (msg.type) {
        case "join": {
          const uid = msg?.user?.id || msg?.user?.userId || msg?.user;
          if (!uid) break;

          ensurePeer(uid);
          await publishCamTo(uid);

          if (sharing.value) await screenStartTo(uid);
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

        case "subscribed": {
          if (msg.cam) {
            const stream = kt.getStream(msg.user);
            if (stream) await setStream("cam", msg.user, stream);
          } else {
            const stream = kt.getStream("screen");
            if (stream) await setStream("screen", msg.user, stream);
            else await clearStream("screen", msg.user);
          }
          break;
        }

        case "shareStop": {
          const sender = msg.sender || msg.user;
          if (sender) await clearStream("screen", sender);
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
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
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
    kt?.removeEventListener?.("presence", presenceHandler);
  } catch {}

  localCamStream = stopStream(localCamStream);
  localScreenStream = stopStream(localScreenStream);
});

// 방 생성 함수 + 자동 join 
const createRoom = async () => {
  creating.value = true;
  try {
    const res = await kt.createRoom();
    if (res.code !== "200") return alert("createRoom failed!");
    roomId.value = res.roomId;
    await joinRoom(res.roomId);
  } finally {
    creating.value = false;
  }
};

// 방 입장 함수
const joinRoom = async (overrideRoomId) => {
  let rid =
    typeof overrideRoomId === "string" ? overrideRoomId.trim() : roomId.value.trim();

  // roomid 를 입력하지 않았을때 프롬프트 실행하여 입력
  if (!rid) {
    const input = prompt("입장할 roomId를 입력하세요.");
    if (!input) return;
    rid = input.trim();
    roomId.value = rid;
  }

  joining.value = true;
  try {
    const res = await kt.joinRoom(rid);
    if (res.code !== "200") return alert("joinRoom failed!");

    joined.value = true;

    ensurePeer(kt.getUserId());

    await startLocalCamIfNeeded();
    await publishCamToAllInRoom(res);
  } finally {
    joining.value = false;
  }
};

// 화면 공유 함수
const startScreenShare = async () => {
  try {
    sharing.value = true;

    await kt.shareStop().catch(() => {});
    screenTargets.clear();

    if (localScreenStream) {
      localScreenStream.getTracks().forEach((t) => t.stop());
      localScreenStream = null;
    }

    await startScreenStreamIfNeeded();
    await screenStartToAll();
  } catch (e) {
    console.error(e);
    sharing.value = false;
    alert(String(e?.message || e));
  }
};

// 화면 공유 중지 함수
const stopScreenShare = async () => {
  sharing.value = false;
  screenTargets.clear();

  await kt.shareStop().catch(() => {});

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
  }

  const me = kt?.getUserId?.();
  if (me) await clearStream("screen", me);
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