module.exports = class Session {
    #id = '';
    #request = {};
    #data = {};
    #session_engine = {};
    #cookie_options = {};
    #methods = {};
    #ready = false;
    #parsed = false;
    #from_database = false;
    #persist = false;
    #destroyed = false;
    #prefixes = {
        duration: '_he_cdur',
    };

    constructor(request, session_engine) {
        this.#request = request;
        this.#session_engine = session_engine;
        this.#cookie_options = session_engine.get_cookie_options();
        this.#methods = session_engine.expose_methods();
    }

    generate_id() {
        return this.#methods.id();
    }

    async roll() {
        this.#id = await this.generate_id();
        this.#parsed = true;
        return true;
    }

    duration() {
        return typeof this.#data[this.#prefixes.duration] == 'number'
            ? this.#data[this.#prefixes.duration]
            : this.#session_engine.duration_msecs;
    }

    update_duration(duration_msecs) {
        if (typeof duration_msecs !== 'number') throw new Error('HyperExpress: .update_duration() only takes a timestamp in milliseconds');
        this.#data[this.#prefixes.duration] = duration_msecs;
        return this;
    }

    id() {
        // Parse signed cookie and cache for future access operations
        if (this.#parsed === true) return this.#id;
        this.#id = this.#request.unsign_cookie(this.#cookie_options.name, this.#cookie_options.secret) || '';
        this.#parsed = true;
        return this.#id;
    }

    ready() {
        return this.#ready;
    }

    set(key, value) {
        if (this.#data[key] !== value) {
            this.#persist = true;
            this.#data[key] = value;
        }
        return this;
    }

    setAll(value) {
        if (typeof value !== 'object') throw new Error('HyperExpress: setAll(object) only takes in a Javascript object');
        this.#data = value;
        this.#persist = true;
        return this;
    }

    get(key) {
        return this.#data[key];
    }

    getAll() {
        return this.#data;
    }

    delete(key) {
        if (this.#data[key]) {
            delete this.#data[key];
            this.#persist = true;
        }
        return this;
    }

    deleteAll() {
        this.#data = {};
        this.#persist = true;
        return this;
    }

    _get_expiry_ts() {
        return Date.now() + this.duration();
    }

    async start() {
        // Parse id & return if no session exists
        this.#id = this.id();
        if (this.#id.length == 0) {
            this.#id = await this.#methods.id();
            this.#ready = true;
            return; // Do not pull since no existing session was found
        }

        // Read session from database and update session data
        let response = await this.#methods.read(this.#id);
        if (typeof response == 'object') {
            this.#from_database = true;
            this.#data = response;
        } else {
            this.#from_database = false;
        }

        this.#ready = true;
        return this;
    }

    async touch(perform_now = false) {
        // Parse id & return if no session exists
        this.#id = this.id();
        if (this.#id.length == 0) return;
        if (perform_now === true) {
            await this.#methods.touch(this.#id, this._get_expiry_ts());
        } else {
            this.#persist = true; // Will persist after request end
        }
    }

    async destroy() {
        this.#id = this.id();
        this.#destroyed = true;
        if (this.#id.length == 0) return;
        await this.#methods.destroy(this.#id);
    }

    perform_sess_closure(response) {
        // Set proper cookie header according to session status
        if (this.#destroyed === true) {
            response.delete_cookie(this.#cookie_options.name);
        } else {
            response.cookie(this.#cookie_options.name, this.#id, this.duration(), this.#session_engine.get_cookie_options());
        }

        // Persist or touch session
        if (this.#persist === true) {
            this.#methods
                .write(this.#id, JSON.stringify(this.#data), this._get_expiry_ts(), this.#from_database)
                .catch((error) => response.throw_error(error));
        } else if (this.#session_engine.require_manual_touch !== true) {
            this.touch(true).catch((error) => response.throw_error(error));
        }
    }
};