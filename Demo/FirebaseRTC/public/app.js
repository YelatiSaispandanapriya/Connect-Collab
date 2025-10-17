// Ensure DOM is fully loaded before running any JS
document.addEventListener('DOMContentLoaded', () => {
  // Attach ripple effect to all buttons
  document.querySelectorAll('.mdc-button').forEach(btn => {
    mdc.ripple.MDCRipple.attachTo(btn);
  });

  const configuration = {
    iceServers: [
      { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ],
    iceCandidatePoolSize: 10
  };

  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let roomDialog = null;
  let roomId = null;

  function init() {
    document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
    document.querySelector('#hangupBtn').addEventListener('click', hangUp);
    document.querySelector('#createBtn').addEventListener('click', createRoom);
    document.querySelector('#joinBtn').addEventListener('click', joinRoom);

    // Initialize room dialog
    roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
  }

  // -------------------- CAMERA & MIC --------------------
  async function openUserMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      remoteStream = new MediaStream();

      document.querySelector('#localVideo').srcObject = localStream;
      document.querySelector('#remoteVideo').srcObject = remoteStream;

      document.querySelector('#cameraBtn').disabled = true;
      document.querySelector('#createBtn').disabled = false;
      document.querySelector('#joinBtn').disabled = false;
      document.querySelector('#hangupBtn').disabled = false;
    } catch (err) {
      console.error('Error accessing camera/microphone:', err);
      alert('Please allow camera and microphone access.');
    }
  }

  // -------------------- CREATE ROOM --------------------
  async function createRoom() {
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;

    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc();

    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const callerCandidatesCollection = roomRef.collection('callerCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (event.candidate) callerCandidatesCollection.add(event.candidate.toJSON());
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await roomRef.set({ offer: { type: offer.type, sdp: offer.sdp } });
    roomId = roomRef.id;
    document.querySelector('#currentRoom').innerText =
      `Current room: ${roomId} (Caller)`;

    remoteStream = new MediaStream();
    document.querySelector('#remoteVideo').srcObject = remoteStream;

    peerConnection.addEventListener('track', event => {
      event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    });

    // Listen for remote answer
    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (!peerConnection.currentRemoteDescription && data?.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    // Listen for remote ICE candidates
    roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
  }

  // -------------------- JOIN ROOM --------------------
  function joinRoom() {
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;

    document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
      roomId = document.querySelector('#room-id').value;
      document.querySelector('#currentRoom').innerText =
        `Current room: ${roomId} (Callee)`;
      await joinRoomById(roomId);
    }, { once: true });

    roomDialog.open();
  }

  async function joinRoomById(roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) return alert('Room does not exist!');

    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (event.candidate) calleeCandidatesCollection.add(event.candidate.toJSON());
    });

    remoteStream = new MediaStream();
    document.querySelector('#remoteVideo').srcObject = remoteStream;
    peerConnection.addEventListener('track', event => {
      event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    });

    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await roomRef.update({ answer: { type: answer.type, sdp: answer.sdp } });

    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
  }

  // -------------------- HANG UP --------------------
  async function hangUp() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (remoteStream) remoteStream.getTracks().forEach(track => track.stop());
    if (peerConnection) peerConnection.close();

    document.querySelector('#localVideo').srcObject = null;
    document.querySelector('#remoteVideo').srcObject = null;
    document.querySelector('#currentRoom').innerText = '';
    document.querySelector('#cameraBtn').disabled = false;
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;
    document.querySelector('#hangupBtn').disabled = true;

    if (roomId) {
      const db = firebase.firestore();
      const roomRef = db.collection('rooms').doc(roomId);

      const calleeCandidates = await roomRef.collection('calleeCandidates').get();
      calleeCandidates.forEach(c => c.ref.delete());

      const callerCandidates = await roomRef.collection('callerCandidates').get();
      callerCandidates.forEach(c => c.ref.delete());

      await roomRef.delete();
    }

    peerConnection = null;
    localStream = null;
    remoteStream = null;
    roomId = null;
  }

  // -------------------- PEER CONNECTION LISTENERS --------------------
  function registerPeerConnectionListeners() {
    peerConnection.addEventListener('icegatheringstatechange', () => {
      console.log(`ICE gathering state: ${peerConnection.iceGatheringState}`);
    });
    peerConnection.addEventListener('connectionstatechange', () => {
      console.log(`Connection state: ${peerConnection.connectionState}`);
    });
    peerConnection.addEventListener('signalingstatechange', () => {
      console.log(`Signaling state: ${peerConnection.signalingState}`);
    });
    peerConnection.addEventListener('iceconnectionstatechange', () => {
      console.log(`ICE connection state: ${peerConnection.iceConnectionState}`);
    });
  }

  // Initialize everything
  init();
});
