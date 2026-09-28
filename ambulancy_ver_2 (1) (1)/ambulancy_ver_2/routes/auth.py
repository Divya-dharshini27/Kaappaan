from flask import Blueprint, render_template, request, redirect, url_for, session
from extensions import mongo
import bcrypt

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/")
def index():
    return redirect(url_for("auth.login"))


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").encode()
        role     = request.form.get("role", "driver")

        if role == "driver":
            user = mongo.db.drivers.find_one({"username": username})
        elif role == "admin":
            # admin doc has no 'role' field — just look up by username
            user = mongo.db.admins.find_one({"username": username, "role": {"$exists": False}})
        elif role == "controlroom":
            # controlroom doc has role: "controlroom"
            user = mongo.db.admins.find_one({"username": username, "role": "controlroom"})
        else:
            user = None

        if user and bcrypt.checkpw(password, user["password"].encode()):
            session["user_id"] = str(user["_id"])
            session["role"]    = role
            session["name"]    = user.get("name", username)

            if role == "admin":
                return redirect(url_for("admin.dashboard"))
            elif role == "controlroom":
                return redirect(url_for("controlroom.dashboard"))
            else:
                return redirect(url_for("driver.dashboard"))
        else:
            error = "Invalid username or password."

    return render_template("login.html", error=error)


@auth_bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
