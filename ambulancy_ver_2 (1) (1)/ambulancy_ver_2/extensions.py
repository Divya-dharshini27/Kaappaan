from flask_pymongo import PyMongo
from flask_session import Session
from flask_socketio import SocketIO

mongo    = PyMongo()
sess     = Session()
socketio = SocketIO()
