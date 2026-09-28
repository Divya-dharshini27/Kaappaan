from flask import Blueprint, render_template, session, redirect, url_for
from extensions import mongo
from functools import wraps

controlroom_bp = Blueprint("controlroom", __name__, url_prefix="/controlroom")


def controlroom_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get("role") != "controlroom":
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return decorated


@controlroom_bp.route("/dashboard")
@controlroom_required
def dashboard():
    forwarded = list(mongo.db.forwarded_emergencies.find({}, {"_id": 0}).sort("forwarded_at", -1))
    return render_template("controlroom_dashboard.html", forwarded=forwarded)
