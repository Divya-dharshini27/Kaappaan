from flask import Blueprint, render_template, session, redirect, url_for
from extensions import mongo
from functools import wraps

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get("role") != "admin":
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return decorated


@admin_bp.route("/dashboard")
@admin_required
def dashboard():
    drivers     = list(mongo.db.drivers.find())
    total       = len(drivers)
    active      = sum(1 for d in drivers if d.get("status") == "online")
    emergency   = sum(1 for d in drivers if d.get("status") == "emergency")
    offline     = total - active - emergency

    stats = {
        "total":     total,
        "active":    active,
        "emergency": emergency,
        "offline":   offline,
    }
    return render_template("admin_dashboard.html", drivers=drivers, stats=stats)
