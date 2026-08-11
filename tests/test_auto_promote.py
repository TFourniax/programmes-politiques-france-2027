from scripts.auto_promote import priority, quote_ok, resolve_owner, same_host, sanitize


def test_quote_requires_exact_short_span():
    source = "Nous proposons de fixer l'âge légal de départ à 64 ans et de développer la capitalisation."
    assert quote_ok("fixer l'âge légal de départ à 64 ans", source)
    assert not quote_ok("fixer l'âge légal de départ à 62 ans", source)
    assert not quote_ok(" ".join(["mot"] * 19), source)


def test_redirect_must_stay_on_official_host_family():
    assert same_host("https://www.example.fr/a", "https://example.fr/b")
    assert same_host("https://docs.example.fr/a", "https://example.fr/b")
    assert not same_host("https://example.fr/a", "https://evil.example.com/b")


def test_programme_pages_are_processed_first():
    programme = {"url": "https://parti.fr/notre-programme/retraites/", "event_type": "official_new_url"}
    generic = {"url": "https://parti.fr/actualites/fete-locale/", "event_type": "official_new_url"}
    assert priority(programme)[0] > priority(generic)[0]


def test_owner_resolution_keeps_party_candidate_separation():
    candidates = {"alice": {"name": "Alice Martin"}}
    parties = {"parti-x": {"name": "Parti X"}}
    assert resolve_owner("Parti X", candidates, parties) == ("parti-x", "party")
    assert resolve_owner("Alice Martin", candidates, parties) == ("alice", "candidate")


def test_sanitize_rejects_wrong_actor_and_fake_quote():
    allowed = [{"id": "parti-x", "type": "party", "name": "Parti X"}]
    raw = {
        "document_type": "party_programme",
        "claims": [
            {
                "actor_id": "parti-x",
                "actor_type": "party",
                "topic": "retraites",
                "statement": "Le parti propose de créer un étage obligatoire de retraite par capitalisation.",
                "evidence_quote": "créer un étage obligatoire de retraite par capitalisation",
                "certainty": "explicit",
                "relevance": "party_platform",
            },
            {
                "actor_id": "candidat-inconnu",
                "actor_type": "candidate",
                "topic": "retraites",
                "statement": "Cette phrase ne doit pas être attribuée à un candidat inconnu.",
                "evidence_quote": "créer un étage obligatoire de retraite par capitalisation",
                "certainty": "explicit",
                "relevance": "direct",
            },
            {
                "actor_id": "parti-x",
                "actor_type": "party",
                "topic": "retraites",
                "statement": "Cette phrase doit être rejetée car sa preuve n'existe pas dans la source.",
                "evidence_quote": "citation absente de la source",
                "certainty": "explicit",
                "relevance": "party_platform",
            },
        ],
        "status_updates": [],
    }
    claims, statuses, doc_type, published = sanitize(
        raw,
        "Notre programme veut créer un étage obligatoire de retraite par capitalisation pour les actifs.",
        allowed,
        10,
    )
    assert len(claims) == 1
    assert statuses == []
    assert doc_type == "party_programme"
    assert published is None
