"""Coordinate/winding regression tests independent of the game runtime."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec=importlib.util.spec_from_file_location('converter',Path(__file__).with_name('convert-native-assets.py'))
conv=importlib.util.module_from_spec(spec);spec.loader.exec_module(conv)

class Coordinates(unittest.TestCase):
    def test_front_left_up_and_handedness(self):
        c=conv.C
        np.testing.assert_allclose(c.T@c,np.eye(3))
        self.assertAlmostEqual(np.linalg.det(c),1)
        # The importer reflects OBJ Z for Unity. Source left stays Unity left.
        unity=np.diag([1,1,-1])@c
        np.testing.assert_allclose(unity@np.array([1,0,0]),[0,0,1])
        np.testing.assert_allclose(unity@np.array([0,1,0]),[-1,0,0])
        np.testing.assert_allclose(unity@np.array([0,0,1]),[0,1,0])

    def test_authored_face_normals_survive_conversion_and_import(self):
        p=np.array([[0.,0.,0.],[2.,0.,0.],[0.,3.,0.]])
        n=np.array([0.,0.,1.])
        for node in [np.eye(3),np.diag([-2.,3.,4.])]:
            q=p@node.T@conv.C.T
            normal=n@np.linalg.inv(node)@conv.C.T
            if np.linalg.det(node)<0:q=q[[0,2,1]]
            self.assertGreater(np.dot(np.cross(q[1]-q[0],q[2]-q[0]),normal),0)
            q[:,2]*=-1;normal[2]*=-1;q=q[[0,2,1]]
            self.assertGreater(np.dot(np.cross(q[1]-q[0],q[2]-q[0]),normal),0)

    def test_real_source_normals_match_face_orientation(self):
        candidates=list((conv.ROOT/'assets/helipad-native').rglob('helipad_lights_lod0.msh'))
        if not candidates:self.skipTest('Local source asset absent')
        streams,submeshes=conv.mesh(candidates[0])
        checked=0
        for indices in submeshes:
            p=streams['position'][indices['position']]
            n=streams['normal'][indices['normal']].mean(axis=1)
            a=np.einsum('ij,ij->i',np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),n)
            q=p@conv.C.T;nn=n@conv.C.T
            b=np.einsum('ij,ij->i',np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]),nn)
            np.testing.assert_allclose(a,b,atol=1e-7)
            checked+=sum(a>1e-8)
        self.assertGreater(checked,1000)

if __name__=='__main__':unittest.main()
