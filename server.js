const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");

const app = express();
const db = new sqlite3.Database("./bank.db");

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: "bank_secret_key",
    resave: false,
    saveUninitialized: false
}));

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            accountNumber TEXT UNIQUE NOT NULL,
            balance REAL NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            accountNumber TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

function checkLogin(req, res, next) {
    if (req.session.user) next();
    else res.redirect("/login");
}

app.get("/", (req, res) => {
    if (req.session.user) res.redirect("/dashboard");
    else res.redirect("/login");
});

app.get("/login", (req, res) => {
    res.render("login", { error: "" });
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE email = ? AND password = ?",
        [email, password],
        (err, user) => {
            if (err) {
                return res.render("login", { error: "Database error" });
            }

            if (!user) {
                return res.render("login", { error: "Invalid Email or Password" });
            }

            req.session.user = user;
            res.redirect("/dashboard");
        }
    );
});

app.get("/register", (req, res) => {
    res.render("register", { error: "" });
});

app.post("/register", (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.render("register", { error: "Fill all fields" });
    }

    db.run(
        "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
        [name.trim(), email.trim(), password],
        function (err) {
            if (err) {
                return res.render("register", { error: "User already exists" });
            }
            res.redirect("/login");
        }
    );
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

app.get("/dashboard", checkLogin, (req, res) => {
    db.get("SELECT COUNT(*) AS totalAccounts FROM accounts", [], (err1, a) => {
        if (err1) return res.send("Database error");

        db.get("SELECT IFNULL(SUM(balance),0) AS totalBalance FROM accounts", [], (err2, b) => {
            if (err2) return res.send("Database error");

            db.all("SELECT * FROM transactions ORDER BY id DESC LIMIT 5", [], (err3, t) => {
                if (err3) return res.send("Database error");

                res.render("index", {
                    username: req.session.user.name,
                    totalAccounts: a.totalAccounts,
                    totalBalance: b.totalBalance,
                    recentTransactions: t
                });
            });
        });
    });
});

app.get("/bank", checkLogin, (req, res) => {
    db.all("SELECT * FROM accounts ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.send("Database error");

        res.render("bank", {
            username: req.session.user.name,
            accounts: rows,
            searchValue: ""
        });
    });
});

app.get("/search", checkLogin, (req, res) => {
    const accountNumber = req.query.accountNumber || "";

    db.all(
        "SELECT * FROM accounts WHERE accountNumber LIKE ? ORDER BY id DESC",
        [`%${accountNumber}%`],
        (err, rows) => {
            if (err) return res.send("Search error");

            res.render("bank", {
                username: req.session.user.name,
                accounts: rows,
                searchValue: accountNumber
            });
        }
    );
});

app.post("/create", checkLogin, (req, res) => {
    const { name, accountNumber, balance } = req.body;
    const amount = parseFloat(balance);

    if (!name || !accountNumber || isNaN(amount) || amount < 0) {
        return res.send("Please enter valid account details");
    }

    db.run(
        "INSERT INTO accounts (name, accountNumber, balance) VALUES (?, ?, ?)",
        [name.trim(), accountNumber.trim(), amount],
        function (err) {
            if (err) {
                return res.send("Account number already exists");
            }

            db.run(
                "INSERT INTO transactions (accountNumber, type, amount) VALUES (?, ?, ?)",
                [accountNumber.trim(), "Create", amount]
            );

            res.redirect("/bank");
        }
    );
});

app.post("/deposit", checkLogin, (req, res) => {
    const { accountNumber, amount } = req.body;
    const depositAmount = parseFloat(amount);

    if (!accountNumber || isNaN(depositAmount) || depositAmount <= 0) {
        return res.send("Please enter valid deposit details");
    }

    db.get(
        "SELECT * FROM accounts WHERE accountNumber = ?",
        [accountNumber.trim()],
        (err, row) => {
            if (err) return res.send("Database error");
            if (!row) return res.send("Account not found");

            const newBalance = parseFloat(row.balance) + depositAmount;

            db.run(
                "UPDATE accounts SET balance = ? WHERE accountNumber = ?",
                [newBalance, accountNumber.trim()],
                function (err) {
                    if (err) return res.send("Deposit failed");

                    db.run(
                        "INSERT INTO transactions (accountNumber, type, amount) VALUES (?, ?, ?)",
                        [accountNumber.trim(), "Deposit", depositAmount]
                    );

                    res.redirect("/bank");
                }
            );
        }
    );
});

app.post("/withdraw", checkLogin, (req, res) => {
    const { accountNumber, amount } = req.body;
    const withdrawAmount = parseFloat(amount);

    if (!accountNumber || isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return res.send("Please enter valid withdraw details");
    }

    db.get(
        "SELECT * FROM accounts WHERE accountNumber = ?",
        [accountNumber.trim()],
        (err, row) => {
            if (err) return res.send("Database error");
            if (!row) return res.send("Account not found");

            const currentBalance = parseFloat(row.balance);

            if (withdrawAmount > currentBalance) {
                return res.send("Insufficient balance");
            }

            const newBalance = currentBalance - withdrawAmount;

            db.run(
                "UPDATE accounts SET balance = ? WHERE accountNumber = ?",
                [newBalance, accountNumber.trim()],
                function (err) {
                    if (err) return res.send("Withdraw failed");

                    db.run(
                        "INSERT INTO transactions (accountNumber, type, amount) VALUES (?, ?, ?)",
                        [accountNumber.trim(), "Withdraw", withdrawAmount]
                    );

                    res.redirect("/bank");
                }
            );
        }
    );
});

app.post("/delete/:id", checkLogin, (req, res) => {
    const id = req.params.id;

    db.get("SELECT * FROM accounts WHERE id = ?", [id], (err, row) => {
        if (err) return res.send("Delete failed");
        if (!row) return res.send("Account not found");

        db.run("DELETE FROM accounts WHERE id = ?", [id], function (err) {
            if (err) return res.send("Delete failed");

            db.run(
                "INSERT INTO transactions (accountNumber, type, amount) VALUES (?, ?, ?)",
                [row.accountNumber, "Delete", row.balance]
            );

            res.redirect("/bank");
        });
    });
});

app.get("/transactions", checkLogin, (req, res) => {
    db.all("SELECT * FROM transactions ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.send("Database error");

        res.render("transactions", {
            username: req.session.user.name,
            transactions: rows
        });
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running...");
});