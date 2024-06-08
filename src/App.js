import React, { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import './App.css';

let socket;
let roomId;
let currentPlayer = 'X';
let playerSymbol;
let playerName;
let opponentName;
let board = ['', '', '', '', '', '', '', '', ''];
let readyToRestart = { player: false, opponent: false };
let winCount = 0;
let lossCount = 0;
let tieCount = 0;

const App = () => {
  const [gameState, setGameState] = useState({
    board: ['', '', '', '', '', '', '', '', ''],
    status: '',
    showGame: false,
    showRoomManagement: true,
    showRoomCode: false,
    showLoading: false,
    winCount: 0,
    lossCount: 0,
    tieCount: 0,
    opponentJoined: false,
    isCreator: false,
  });

  const makeMove = (index) => {
    if (board[index] === '' && currentPlayer === playerSymbol) {
      board[index] = playerSymbol;
      socket.send(JSON.stringify({ type: 'move', board: board, currentPlayer: playerSymbol }));
    }
  };

  const renderBoard = useCallback((winningCombination = [], result = null) => {
    const winningTiles = winningCombination.map(index => `#${index + 1}`).join(', ');
    setGameState((prevState) => ({
      ...prevState,
      board: board.map((cell, index) => ({
        value: cell,
        isWinningCell: winningCombination.includes(index),
        winner: result === playerSymbol ? 'winner' : result !== playerSymbol ? 'loser' : null,
      })),
      winningTiles: winningTiles,
    }));
  }, []);

  useEffect(() => {
    renderBoard();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [renderBoard]);

  const handleBeforeUnload = (e) => {
    const message = 'Are you sure you want to leave the game?';
    e.preventDefault();
    e.returnValue = message;
    return message;
  };

  const createRoom = async () => {
    const numericValues = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
    roomId = numericValues;
    playerSymbol = 'X';
    playerName = localStorage.getItem('playerName') || await Swal.fire({
      title: 'Enter Your Name',
      input: 'text',
      inputAttributes: {
        autocapitalize: 'off'
      },
      showCancelButton: false,
      confirmButtonText: 'Submit',
      showLoaderOnConfirm: true,
      preConfirm: (name) => {
        localStorage.setItem('playerName', name);
        return name;
      }
    }).then((result) => result.value);

    initializeWebSocket();
    setGameState((prevState) => ({
      ...prevState,
      showRoomManagement: false,
      status: `Room created. Waiting for opponent...`,
      showRoomCode: true,
      isCreator: true
    }));
  };

  const joinRoom = async () => {
    roomId = await Swal.fire({
      title: 'Enter Room Code',
      input: 'text',
      inputAttributes: {
        autocapitalize: 'off'
      },
      showCancelButton: false,
      confirmButtonText: 'Join'
    }).then((result) => result.value);

    playerName = localStorage.getItem('playerName') || await Swal.fire({
      title: 'Enter Your Name',
      input: 'text',
      inputAttributes: {
        autocapitalize: 'off'
      },
      showCancelButton: false,
      confirmButtonText: 'Submit',
      showLoaderOnConfirm: true,
      preConfirm: (name) => {
        localStorage.setItem('playerName', name);
        return name;
      }
    }).then((result) => result.value);

    playerSymbol = 'O';
    initializeWebSocket();
    setGameState((prevState) => ({
      ...prevState,
      showRoomManagement: false,
      status: `Joined room ${roomId}. Waiting for the game to start...`
    }));
  };

  const initializeWebSocket = () => {
    socket = new WebSocket('ws://localhost:8080');

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join', roomId: roomId, playerName: playerName }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'start') {
        opponentName = message.opponentName;
        currentPlayer = message.currentPlayer;
        setGameState((prevState) => ({
          ...prevState,
          status: `Game started! Your opponent is ${opponentName}. ${currentPlayer === playerSymbol ? 'Your turn.' : 'Waiting for opponent\'s move...'}`,
          showRoomCode: false,
          opponentJoined: true,
          showGame: true
        }));
      } else if (message.type === 'full') {
        setGameState((prevState) => ({ ...prevState, status: 'Room is full!' }));
      } else if (message.type === 'move') {
        board = message.board;
        const result = message.winner;
        const combination = message.combination;
        if (result) {
          if (result === playerSymbol) {
            winCount++;
          } else if (result !== playerSymbol) {
            lossCount++;
          } else {
            tieCount++;
          }
          renderBoard(combination, result);
          updateGameStats();
          if (result === playerSymbol) {
            setGameState((prevState) => ({ ...prevState, status: 'You win!' }));
          } else if (result !== playerSymbol) {
            setGameState((prevState) => ({ ...prevState, status: 'You lose!' }));
          } else {
            setGameState((prevState) => ({ ...prevState, status: 'It\'s a tie!' }));
          }
          promptRestart();
        } else if (!board.includes('')) {
          tieCount++;
          renderBoard();
          updateGameStats();
          setGameState((prevState) => ({ ...prevState, status: 'It\'s a tie!' }));
          promptRestart();
        } else {
          currentPlayer = message.currentPlayer;
          renderBoard();
          if (currentPlayer === playerSymbol) {
            setGameState((prevState) => ({ ...prevState, showLoading: false, status: 'Your turn.' }));
          } else {
            setGameState((prevState) => ({ ...prevState, showLoading: true, status: `${opponentName}'s move...` }));
          }
        }
      } else if (message.type === 'restart') {
        readyToRestart = { player: false, opponent: false };
        board = ['', '', '', '', '', '', '', '', ''];
        renderBoard();
        setGameState((prevState) => ({ ...prevState, showLoading: false, status: 'Game restarted.' }));
      } else if (message.type === 'opponentReady') {
        readyToRestart.opponent = true;
        checkReadyToRestart();
      } else if (message.type === 'opponentLeft') {
        setGameState((prevState) => ({ ...prevState, status: 'Your opponent has left. You win!' }));
        winCount++;
      }
    };

    socket.onclose = (event) => {
      console.error('WebSocket is closed now.', event);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error observed:', error);
    };
  };

  const updateGameStats = () => {
    setGameState((prevState) => ({
      ...prevState,
      winCount: winCount,
      lossCount: lossCount,
      tieCount: tieCount
    }));
  };

  const promptRestart = () => {
    Swal.fire({
      title: 'Do you want to play again?',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: `Yes`,
      denyButtonText: `No`,
    }).then((result) => {
      if (result.isConfirmed) {
        readyToRestart.player = true;
        socket.send(JSON.stringify({ type: 'restartRequest', roomId: roomId }));
        checkReadyToRestart();
      } else {
        socket.close();
        board = ['', '', '', '', '', '', '', '', ''];
        setGameState((prevState) => ({ ...prevState, showGame: false, showRoomManagement: true }));
      }
    });
  };
  
  const checkReadyToRestart = () => {
    if (readyToRestart.player && readyToRestart.opponent) {
      socket.send(JSON.stringify({ type: 'restart' }));
      readyToRestart.player = false;
      readyToRestart.opponent = false;
    }
  };

  const copyRoomCode = () => {
    const roomCodeText = document.getElementById('room-code-text');
    navigator.clipboard.writeText(roomCodeText.innerText)
      .then(() => {
        Swal.fire('Room code copied to clipboard');
      })
      .catch((err) => {
        console.error('Could not copy text: ', err);
      });
  };

  const exitRoom = () => {
    if (socket) {
      socket.send(JSON.stringify({ type: 'leaveRoom' }));
    }
    localStorage.removeItem('roomId');
    socket.close();
    window.location.href = '/'; 
  };

  const startGame = () => {
    socket.send(JSON.stringify({ type: 'startGame' }));
  };

  return (
    <div id="app">
      <h1>Tic Tac Toe</h1>
      {gameState.showRoomManagement && (
        <div id="room-management" className="card">
          <button className="btn" onClick={joinRoom}>Join Room</button>
          <button className="btn" onClick={createRoom}>Create Room</button>
        </div>
      )}
      {gameState.showRoomCode && (
        <div id="room-code" className="card">
          Room Code: <span id="room-code-text">{roomId}</span>
          <button className="btn" onClick={copyRoomCode}>Copy</button><br/><br/>
		  <div id="loading"><div className="loader"></div><h3>Waiting for opponent...</h3></div><br/>
          <div id="exit-room">
            <button className="btn" onClick={exitRoom}>Exit Room</button>
          </div>
        </div>
      )}
      {gameState.showGame && (
        <div id="game" className="card">
          <div id="game-container">
            <div id="board">
              {gameState.board.map((cell, index) => (
                <div
                  key={index}
                  className={`cell ${cell.isWinningCell ? 'winning-cell' : ''} ${cell.winner === 'winner' ? 'winner' : cell.winner === 'loser' ? 'loser' : ''}`}
                  onClick={() => makeMove(index)}
                >
                  {cell.value}
                </div>
              ))}
            </div>
            <div id="game-info">
              <div id="status">{gameState.status}</div>
              <div id="game-stats">
                <div>Wins: <span id="win-count">{gameState.winCount}</span></div>
                <div>Losses: <span id="loss-count">{gameState.lossCount}</span></div>
                <div>Ties: <span id="tie-count">{gameState.tieCount}</span></div>
              </div>
              {gameState.showLoading && (
                <div id="loading">
                  <div className="loader"></div>
                  Waiting for opponent's move...
                </div>
              )}
              <div id="exit-room">
                <button className="btn" onClick={exitRoom}>Exit Room</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;