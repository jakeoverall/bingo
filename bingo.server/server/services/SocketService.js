import SocketIO from 'socket.io'
import { Auth0Provider } from '@bcwdev/auth0provider'
import { logger } from '../utils/Logger'
import { attachHandlers } from '../../Setup'
import { accountService } from './AccountService'

const users = {}
const bingos = []

class SocketService {
  io = SocketIO();
  /**
   * @param {SocketIO.Server} io
   */
  setIO(io) {
    try {
      this.io = io
      // Server listeners
      io.on('connection', this._onConnect())
    } catch (e) {
      logger.error('[SOCKETSTORE ERROR]', e)
    }
  }

  /**
   * @param {SocketIO.Socket} socket
   */
  async authenticate(socket, bearerToken) {
    try {
      const user = await Auth0Provider.getUserInfoFromBearerToken(bearerToken)
      const profile = await accountService.getAccount(user)
      const limitedProfile = {
        id: profile.id,
        email: profile.email,
        picture: profile.picture
      }
      await attachHandlers(this.io, socket, user, limitedProfile)
      socket.join(user.id)
      socket.emit('authenticated', limitedProfile)
      this.io.emit('UserConnected', user.id)
    } catch (e) {
      socket.emit('error', e)
    }
  }

  /**
   * Sends a direct message to a user
   * @param {string} userId
   * @param {string} eventName
   * @param {any} payload
   */
  messageUser(userId, eventName, payload) {
    try {
      this.io.to(userId).emit(eventName, payload)
    } catch (e) {
      logger.error('[SOCKET_ERROR] messageUser', e, { userId, eventName, payload })
    }
  }

  messageRoom(room, eventName, payload) {
    this.io.to(room).emit(eventName, payload)
  }

  _onConnect() {
    return socket => {
      this._newConnection(socket)
      socket.on('disconnect', this._onDisconnect(socket))
      socket.on('authenticate', (bearerToken) => this.authenticate(socket, bearerToken))

      socket.join('general')
      socket.emit('set:users', users)
      socket.emit('set:bingos', bingos)

      socket.on('bingo', (board) => {
        if (!socket.userInfo) { return }
        const bingo = { board, user: socket.userInfo, id: socket.userInfo.id + '::' + ~~(Math.random() * 10000000) }
        bingos.push(bingo)
        this.messageRoom('general', 'bingo', bingo)
      })

      socket.on('set:user', (user) => {
        if (user) {
          if (socket.userInfo) {
            delete users[socket.userInfo.id]
            this.messageRoom('general', 'user:disconnected', socket.userInfo)
          }
          socket.userInfo = user
          users[socket.userInfo.id] = user
          this.messageRoom('general', 'user:connected', user)
        }
      })
    }
  }

  _onDisconnect(socket) {
    return () => {
      try {
        if (!socket.userInfo) {
          return
        }
        delete users[socket.userInfo.id]
        this.messageRoom('general', 'user:disconnected', socket.userInfo)
      } catch (e) {}
    }
  }

  _newConnection(socket) {
    // Handshake / Confirmation of Connection
    socket.emit('connected', {
      socket: socket.id,
      message: 'Successfully Connected'
    })
  }
}

const socketService = new SocketService()

export default socketService
