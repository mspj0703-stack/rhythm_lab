from chartgen.chart_ai_v2 import refine_selected_events
from chartgen.config import DIFFICULTIES
from chartgen.events import MusicalEvent

def ev(t, sal, div=16, beat=False, contrast=.2):
    return MusicalEvent(t,t,sal,sal,"mid",{},beat,0,div,0,contrast,sal)

def test_v2_removes_weak_dense_offgrid_filler_but_keeps_accent():
    notes=[ev(0,.8,4,True),ev(.11,.2,None),ev(.22,.75,8),ev(.33,.85,4,True)]
    out, stats=refine_selected_events(notes, DIFFICULTIES["hard"])
    assert notes[1] not in out
    assert notes[0] in out and notes[3] in out
    assert stats.removed_filler == 1

def test_v2_is_deterministic():
    notes=[ev(i*.12, .3 + (i%3)*.2, None if i%2 else 16) for i in range(12)]
    a,_=refine_selected_events(notes, DIFFICULTIES["normal"])
    b,_=refine_selected_events(notes, DIFFICULTIES["normal"])
    assert [(x.time,x.salience) for x in a] == [(x.time,x.salience) for x in b]
